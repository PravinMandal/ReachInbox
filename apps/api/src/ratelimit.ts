import { redis } from "./redis.js";

/**
 * Atomic hourly-quota reservation over BOTH counters in one Lua round-trip,
 * safe across N workers. Returns `ok` (one slot consumed from each counter)
 * or `limited` (nothing consumed). Fail-closed and TTL-bounded: a crash after
 * INCR leaks at most one slot for <1h — we send fewer, never overshoot.
 */
const LUA = `
local g = tonumber(redis.call('GET', KEYS[1]) or '0')
local s = tonumber(redis.call('GET', KEYS[2]) or '0')
if g >= tonumber(ARGV[1]) or s >= tonumber(ARGV[2]) then
  return 0
end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 3700)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 3700)
return 1
`;

type RedisWithQuota = typeof redis & {
  tryReserveQuota?: (
    globalKey: string,
    senderKey: string,
    globalCap: number,
    senderCap: number,
  ) => Promise<number>;
};

function ensureCommand(r: RedisWithQuota): void {
  if (r.tryReserveQuota) return;
  r.defineCommand("tryReserveQuota", { numberOfKeys: 2, lua: LUA });
}

export async function tryReserveQuota(
  globalKey: string,
  senderKey: string,
  globalCap: number,
  senderCap: number,
): Promise<"ok" | "limited"> {
  const r = redis as RedisWithQuota;
  ensureCommand(r);
  const res = (await r.tryReserveQuota!(globalKey, senderKey, globalCap, senderCap)) as unknown as number;
  return Number(res) === 1 ? "ok" : "limited";
}

/** Return a slot after a lost CAS race — the reservation is no longer needed. */
export async function compensateQuota(globalKey: string, senderKey: string): Promise<void> {
  const pipe = redis.pipeline();
  pipe.decr(globalKey);
  pipe.decr(senderKey);
  await pipe.exec();
}

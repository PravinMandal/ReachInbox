import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * Two connections: BullMQ requires `maxRetriesPerRequest: null`.
 * `redis` is for our own commands (Lua quota, SETNX dedup); `bullConnection`
 * is passed to Queue/Worker/QueueEvents. Upstash live URL must be TCP
 * `rediss://` — REST mode does not support BullMQ streams/Lua.
 */
function makeConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Upstash TCP needs TLS; local redis ignores this.
    tls: env.REDIS_URL.startsWith("rediss://") ? {} : undefined,
  } as never);
}

export const redis = makeConnection();
export const bullConnection = makeConnection();

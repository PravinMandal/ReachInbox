/**
 * Load helper: schedule N emails for ~now to prove rate-limit/delay behavior.
 * Usage: `npm run bulk-schedule -- --to a@x.io,b@x.io --subject Hi --count 1000`
 * (expands `to` cyclically with `+i` suffixes). Requires DEV_AUTH_BYPASS or a
 * Bearer token via `--token`.
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

async function main(): Promise<void> {
  const base = process.env.API_URL ?? "http://localhost:4000";
  const count = Number(args.count ?? 50);
  const toList = String(args.to ?? "demo@example.com").split(",");
  const recipients = Array.from({ length: count }, (_, i) => {
    const [u, d] = toList[i % toList.length]!.split("@");
    return `${u}+${i}@${d}`;
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  const res = await fetch(`${base}/api/campaigns/schedule`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      subject: String(args.subject ?? "Load test"),
      body: "Hello from bulk-schedule",
      startAt: new Date().toISOString(),
      delaySec: Number(args.delay ?? 2),
      hourlyLimit: Number(args.hourly ?? 200),
      to: recipients,
    }),
  });
  // eslint-disable-next-line no-console
  console.log(res.status, await res.text());
}

main();

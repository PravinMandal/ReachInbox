import { Client } from "@elastic/elasticsearch";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const ES_INDEX = "emails";

/**
 * Lazily-created client so the API boots even when ES is down (Bonsai asleep
 * or unset live). Every call site treats ES as best-effort — search falls back
 * to Postgres, indexing never throws into the send path.
 */
let client: Client | null = null;

export function esClient(): Client {
  if (!client) {
    client = new Client({ node: env.ES_NODE || "http://localhost:9200", requestTimeout: 5000, maxRetries: 1 });
  }
  return client;
}

export function esConfigured(): boolean {
  return Boolean(env.ES_NODE);
}

export interface EsEmailDoc {
  id: string;
  userId: string;
  batchId: string;
  senderId: string;
  to: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
}

export async function ensureIndex(attempts = 6): Promise<void> {
  if (!esConfigured()) {
    logger.info("ES_NODE unset — search uses Postgres fallback");
    return;
  }
  // Retry with backoff: ES (Docker/Bonsai) is often still starting when the API
  // boots. If we give up, the index gets auto-created on first bulk write with
  // WRONG dynamic mappings (userId as `text`), which silently breaks term search.
  for (let i = 1; i <= attempts; i++) {
    try {
      const es = esClient();
      const exists = await es.indices.exists({ index: ES_INDEX });
      if (exists) return;
      await es.indices.create({
        index: ES_INDEX,
        mappings: {
          properties: {
            to: { type: "text", fields: { kw: { type: "keyword" } } },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            batchId: { type: "keyword" },
            scheduledAt: { type: "date" },
            // No null_value: explicit nulls in docs are simply not indexed.
            sentAt: { type: "date" },
          },
        },
      });
      logger.info("ES index created: emails");
      return;
    } catch (err) {
      const last = i === attempts;
      logger.warn({ err, attempt: `${i}/${attempts}` }, "ES ensureIndex failed — retrying");
      if (last) {
        logger.warn("ES ensureIndex gave up — search uses Postgres fallback until ES is up");
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

/** Index one doc. Never throws — email send must not fail because search is down. */
export async function indexEmail(doc: EsEmailDoc): Promise<void> {
  if (!esConfigured()) return;
  try {
    await esClient().index({ index: ES_INDEX, id: doc.id, document: doc, refresh: false });
  } catch (err) {
    logger.warn({ err, id: doc.id }, "ES index failed (non-fatal)");
  }
}

export async function indexMany(docs: EsEmailDoc[]): Promise<void> {
  if (docs.length === 0 || !esConfigured()) return;
  try {
    const ops = docs.flatMap((d) => [{ index: { _index: ES_INDEX, _id: d.id } }, d]);
    await esClient().bulk({ operations: ops as never });
  } catch (err) {
    logger.warn({ err, n: docs.length }, "ES bulk index failed (non-fatal)");
  }
}

export interface EsSearchParams {
  userId: string;
  q: string;
  status?: string;
  from: number;
  size: number;
}

export async function searchEs(params: EsSearchParams): Promise<{ ids: string[]; total: number }> {
  const must: Array<Record<string, unknown>> = [{ term: { userId: params.userId } }];
  if (params.status) must.push({ term: { status: params.status } });
  const res = await esClient().search({
    index: ES_INDEX,
    from: params.from,
    size: params.size,
    track_total_hits: true,
    query: {
      bool: {
        must,
        should: [
          { match: { to: { query: params.q, boost: 3 } } },
          { match: { subject: { query: params.q, boost: 2 } } },
          { match: { body: { query: params.q } } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ scheduledAt: "desc" }],
  } as never);
  const hits = (res.hits.hits ?? []) as Array<{ _id: string }>;
  const total =
    typeof res.hits.total === "number" ? res.hits.total : (res.hits.total?.value ?? hits.length);
  return { ids: hits.map((h) => h._id), total };
}

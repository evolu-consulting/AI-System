// N4 · ADR-0021 §1 (module trong hub-api, không app backend mới — người dùng 2026-10-18) · lớp 4: nối dịch vụ tri thức.
// R1: module có POOL RIÊNG (`KNOWLEDGE_DATABASE_URL`, vắng ⇒ DSN chính `HUB_DATABASE_URL`; dev/test dùng role `knowledge_api` chỉ
// SET ROLE được `knowledge_rw`) — không join chéo schema. Tx = `createPackUow(db, "knowledge")` (role `knowledge_rw`, RLS FORCE).
// Chiến lược theo `KNOWLEDGE_STRATEGY`: `fts` (mặc định) | `embedding` (cần `OPENAI_API_KEY`). Rerank Claude khi
// `KNOWLEDGE_RERANK=on` + `ANTHROPIC_API_KEY` (vắng ⇒ thứ tự FTS/RRF). Tìm liên kết KnowledgeHub khi đủ `KNOWLEDGE_KH_*`.
import { createDb, type Db } from "@ai/db";
import { logger } from "../../lib/logger";
import { createDocxConverter } from "../packs/kit/adapters/docx";
import { createPackUow } from "../packs/kit/adapters/pack-uow";
import { createPdfConverter } from "../packs/kit/adapters/pdf";
import type { PackToolDef } from "../packs/kit/application/pack-tools.ports";
import { claudeReranker, openAiEmbedder } from "./adapters/ai.adapters";
import { graphRepos } from "./adapters/graph.repo";
import { graphTools } from "./adapters/graph.tools";
import { graphAiFromEnv } from "./adapters/graph-ai.adapters";
import { ingestRepo } from "./adapters/ingest.repo";
import { khSource, khSourceConfig } from "./adapters/kh.source";
import { knowledgeRepo, knowledgeRepos } from "./adapters/knowledge.repo";
import { KNOWLEDGE_KEY, knowledgeTools } from "./adapters/knowledge.tools";
import type { GraphUow } from "./application/graph.ports";
import { graphProducers, type IngestUow } from "./application/graph.producers";
import { graphUsecases } from "./application/graph.usecases";
import { ingestFile, type ToText } from "./application/ingest.usecases";
import { addDocument, getKnowledge, searchKnowledge } from "./application/knowledge.usecases";
import type {
  Embedder,
  ExternalSource,
  GraphAi,
  KnowledgeUow,
  Reranker,
  RetrievalStrategy,
} from "./application/ports";
import { embeddingStrategy, ftsStrategy } from "./application/strategies";

export { KNOWLEDGE_KEY };

type EnvMap = Record<string, string | undefined>;
export type KnowledgeAi = { embedder: Embedder | null; reranker: Reranker | null };

const sha256 = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const warn = (msg: string, meta: Record<string, unknown>) => logger.warn(msg, meta);

/** Chọn chiến lược + AI theo env (key không bao giờ log). */
export function knowledgeAiFromEnv(env: EnvMap): KnowledgeAi {
  return {
    embedder: openAiEmbedder(env),
    reranker: env.KNOWLEDGE_RERANK === "on" ? claudeReranker(env) : null,
  };
}

/** Nguồn ngoài theo env: KnowledgeHub khi đủ URL + key + project; vắng ⇒ []. */
export function knowledgeSourcesFromEnv(env: EnvMap, f?: typeof fetch): ExternalSource[] {
  const kh = khSourceConfig(env);
  if (!kh) return [];
  const dev = env.APP_ENV === "development" || env.APP_ENV === "test";
  return [khSource(kh, { dev, ...(f ? { fetch: f } : {}) })];
}

export function pickStrategy(
  uow: KnowledgeUow,
  want: string | undefined,
  embedder: Embedder | null,
): RetrievalStrategy {
  if (want === "embedding") {
    if (embedder) return embeddingStrategy(uow, embedder);
    warn("knowledge-embedding-no-key", { fallback: "fts" });
  }
  return ftsStrategy(uow);
}

export function knowledgeService(
  db: Db,
  o: { env?: EnvMap; ai?: KnowledgeAi; sources?: ExternalSource[] } = {},
) {
  const env = o.env ?? process.env;
  const ai = o.ai ?? knowledgeAiFromEnv(env);
  const uow: KnowledgeUow = createPackUow(db, KNOWLEDGE_KEY, knowledgeRepos);
  const strategy = pickStrategy(uow, env.KNOWLEDGE_STRATEGY, ai.embedder);
  const sources = o.sources ?? knowledgeSourcesFromEnv(env);
  return {
    uow,
    strategy,
    search: searchKnowledge({ strategy, reranker: ai.reranker, sources, log: warn }),
    get: getKnowledge({ uow }),
    // embedding lúc thêm chỉ khi chiến lược dùng nó (không tốn API khi chạy (c))
    add: addDocument({
      uow,
      newId: () => Bun.randomUUIDv7(),
      sha256,
      embedder: strategy.name.startsWith("embedding") ? ai.embedder : null,
      log: warn,
    }),
  };
}

/** G1 · đồ thị tri thức (thay Neo4j) — cùng role/RLS `knowledge_rw`; uow riêng để cổng N4 giữ nguyên. */
export function graphService(db: Db) {
  const uow: GraphUow = createPackUow(db, KNOWLEDGE_KEY, graphRepos);
  return graphUsecases({ uow });
}

/** R1 · bộ chuyển tệp của bộ khung gói (worker ADR-0024 / ADR-0028) bọc thành cổng `ToText`. */
export function fileConverters(): { docx: ToText; pdf: ToText; close(): Promise<void> } {
  const docx = createDocxConverter();
  const pdf = createPdfConverter();
  return {
    docx: (b, tenantId) => docx.toMarkdown(b, { tenantId }),
    pdf: (b, tenantId) => pdf.toText(b, { tenantId }),
    close: async () => {
      await Promise.all([docx.close(), pdf.close()]);
    },
  };
}

/**
 * R1 · nạp tệp (mgmt-app `ingest`): parse → chia đoạn/lưu → sinh đồ thị G1. `graphAi` vắng ⇒ theo env `KNOWLEDGE_GRAPH_AI`
 * (on + ANTHROPIC_API_KEY | fake | tắt). `files` vắng ⇒ chỉ Markdown/văn bản.
 */
export function ingestService(
  db: Db,
  o: {
    env?: EnvMap;
    graphAi?: GraphAi | null;
    files?: { docx: ToText | null; pdf: ToText | null };
    svc?: ReturnType<typeof knowledgeService>;
  } = {},
) {
  const env = o.env ?? process.env;
  const svc = o.svc ?? knowledgeService(db, { env, sources: [] });
  const uow: IngestUow = createPackUow(db, KNOWLEDGE_KEY, (tx, tid) => ({
    knowledge: knowledgeRepo(tx, tid),
    ingest: ingestRepo(tx, tid),
  }));
  const ai = o.graphAi === undefined ? graphAiFromEnv(env) : o.graphAi;
  const produce = graphProducers({ graph: graphService(db), uow, ai, log: warn });
  return ingestFile({
    add: svc.add,
    uow,
    docx: o.files?.docx ?? null,
    pdf: o.files?.pdf ?? null,
    produce,
    log: warn,
  });
}

/**
 * Pool riêng trên `dsn` (server điền `KNOWLEDGE_DATABASE_URL` ‖ `HUB_DATABASE_URL`), ≤ `KNOWLEDGE_DB_POOL_MAX` (mặc định 4);
 * vắng `dsn` (createApp trong test) ⇒ pool chung. Đóng theo `signal`.
 */
export function knowledgeDb(
  dsn: string | undefined,
  env: EnvMap,
  fallback: Db,
  signal?: AbortSignal,
): Db {
  if (!dsn) return fallback;
  const n = Number(env.KNOWLEDGE_DB_POOL_MAX);
  const db = createDb(dsn, { max: Number.isInteger(n) && n >= 1 && n <= 50 ? n : 4 });
  signal?.addEventListener("abort", () => void db.close(), { once: true });
  return db;
}

/** Đăng ký tool `knowledge-*` (gọi từ `mountPacks`). */
export function mountKnowledge(
  db: Db,
  tools: { register(t: PackToolDef): void } | undefined,
  o: { dsn?: string; env?: EnvMap; signal?: AbortSignal } = {},
): void {
  if (!tools) return;
  const env = o.env ?? process.env;
  const kdb = knowledgeDb(o.dsn, env, db, o.signal);
  const svc = knowledgeService(kdb, { env });
  for (const t of knowledgeTools(svc)) tools.register(t);
  for (const t of graphTools(graphService(kdb))) tools.register(t); // G1 · đồ thị tri thức (cùng pool riêng)
}

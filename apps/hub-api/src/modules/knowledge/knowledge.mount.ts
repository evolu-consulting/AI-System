// N4 · ADR-0021 §1 (module trong hub-api, không app backend mới — người dùng 2026-10-18) · lớp 4: nối dịch vụ tri thức.
// Tx = `createPackUow(db, "knowledge")` (role `knowledge_rw`, RLS FORCE). Chiến lược theo `KNOWLEDGE_STRATEGY`: `fts` (mặc định,
// (c)) | `embedding` ((a), cần `OPENAI_API_KEY`; vắng key ⇒ về `fts` + log). Rerank Claude khi `KNOWLEDGE_RERANK=on` và có
// `ANTHROPIC_API_KEY`. Tool MCP đăng ký vào registry tool gói (N2) ⇒ `/mcp` và stage `tool` gọi được.
import type { Db } from "@ai/db";
import { logger } from "../../lib/logger";
import { createPackUow } from "../packs/kit/adapters/pack-uow";
import type { PackToolDef } from "../packs/kit/application/pack-tools.ports";
import { claudeReranker, openAiEmbedder } from "./adapters/ai.adapters";
import { graphRepos } from "./adapters/graph.repo";
import { graphTools } from "./adapters/graph.tools";
import { knowledgeRepos } from "./adapters/knowledge.repo";
import { KNOWLEDGE_KEY, knowledgeTools } from "./adapters/knowledge.tools";
import type { GraphUow } from "./application/graph.ports";
import { graphUsecases } from "./application/graph.usecases";
import { addDocument, getKnowledge, searchKnowledge } from "./application/knowledge.usecases";
import type { Embedder, KnowledgeUow, Reranker, RetrievalStrategy } from "./application/ports";
import { embeddingStrategy, ftsStrategy } from "./application/strategies";

export { KNOWLEDGE_KEY };

export type KnowledgeAi = { embedder: Embedder | null; reranker: Reranker | null };

const sha256 = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const warn = (msg: string, meta: Record<string, unknown>) => logger.warn(msg, meta);

/** Chọn chiến lược + AI theo env (key không bao giờ log). */
export function knowledgeAiFromEnv(env: Record<string, string | undefined>): KnowledgeAi {
  return {
    embedder: openAiEmbedder(env),
    reranker: env.KNOWLEDGE_RERANK === "on" ? claudeReranker(env) : null,
  };
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
  o: { env?: Record<string, string | undefined>; ai?: KnowledgeAi } = {},
) {
  const env = o.env ?? process.env;
  const ai = o.ai ?? knowledgeAiFromEnv(env);
  const uow: KnowledgeUow = createPackUow(db, KNOWLEDGE_KEY, knowledgeRepos);
  const strategy = pickStrategy(uow, env.KNOWLEDGE_STRATEGY, ai.embedder);
  return {
    uow,
    strategy,
    search: searchKnowledge({ strategy, reranker: ai.reranker, log: warn }),
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

/** Đăng ký tool `knowledge-*` (gọi từ `mountPacks`). */
export function mountKnowledge(
  db: Db,
  tools: { register(t: PackToolDef): void } | undefined,
): void {
  if (!tools) return;
  const svc = knowledgeService(db);
  for (const t of knowledgeTools(svc)) tools.register(t);
  for (const t of graphTools(graphService(db))) tools.register(t); // G1 · đồ thị tri thức
}

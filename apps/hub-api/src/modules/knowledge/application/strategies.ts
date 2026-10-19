// N4-FR-03 · ADR-0021 §4 · quyết định người dùng 2026-10-19 (chọn theo số đo): hai chiến lược sau cùng cổng
// `RetrievalStrategy`. (c) `fts`: Postgres FTS tiếng Việt (unaccent + simple) + điểm IDF kiểu BM25 tính trong một câu SQL.
// (a) `embedding`: OpenAI `text-embedding-3-small` (như mgmt-app) — vector ∪ FTS nối hạng RRF (như hybrid OpenSearch của
// mgmt-app); chỉ dựng khi có `OPENAI_API_KEY`.
import { rrf } from "../domain/knowledge.rules";
import { type QueryOpts, queryTerms } from "../domain/text.rules";
import type { Embedder, FtsMode, KnowledgeUow, RetrievalStrategy } from "./ports";

export type FtsStrategyOpts = { mode?: FtsMode; query?: QueryOpts; name?: string };

export function ftsStrategy(uow: KnowledgeUow, o: FtsStrategyOpts = {}): RetrievalStrategy {
  const mode = o.mode ?? "idf";
  return {
    name: o.name ?? (mode === "idf" ? "fts" : "fts-plain"),
    async search(who, query, k) {
      const terms = queryTerms(query, o.query);
      if (terms.length === 0) return [];
      return uow.tenant(who, (r) => r.knowledge.searchFts(terms, { mode, limit: k }));
    },
  };
}

export function embeddingStrategy(
  uow: KnowledgeUow,
  embedder: Embedder,
  o: { hybrid?: boolean; fts?: FtsStrategyOpts } = {},
): RetrievalStrategy {
  const fts = ftsStrategy(uow, o.fts);
  const hybrid = o.hybrid ?? true;
  return {
    name: hybrid ? "embedding-hybrid" : "embedding",
    async search(who, query, k, signal) {
      const [vec] = await embedder.embed([query], signal);
      const pool = Math.max(k, 30);
      const byVec = await uow.tenant(who, (r) =>
        r.knowledge.searchVector(embedder.model, vec as number[], pool),
      );
      if (!hybrid) return byVec.slice(0, k);
      const byText = await fts.search(who, query, pool, signal);
      return rrf([byVec, byText]).slice(0, k);
    },
  };
}

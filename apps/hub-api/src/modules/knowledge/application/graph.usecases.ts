// G1 · CR-095: use case đồ thị tri thức (thay `app/store/graph.py` + `routes/graph.py|similar.py|stats.py` của mgmt-app).
// Kiểm đầu vào bằng luật thuần (`graph.rules`) TRƯỚC khi mở tx; mỗi lời gọi = MỘT tx của tenant người gọi (`GraphUow`, role
// `knowledge_rw`, RLS FORCE). Id lạ / của tenant khác ⇒ kết quả rỗng như id không tồn tại.
import {
  checkIds,
  checkKeys,
  clampInt,
  type GraphError,
  isUuid,
  GRAPH_LIMITS as L,
  toCorpus,
  toNeighbourhood,
  validKey,
} from "../domain/graph.rules";
import type {
  ChunkGraphIn,
  ChunkLinkIn,
  ConflictRow,
  Graph,
  GraphRepos,
  GraphStats,
  GraphUow,
  SimilarRow,
} from "./graph.ports";
import type { Who } from "./ports";

export type GResult<T> = { ok: true; value: T } | { ok: false; code: GraphError };
const fail = <T>(code: GraphError): GResult<T> => ({ ok: false, code });
const ok = <T>(value: T): GResult<T> => ({ ok: true, value });

function checkAttach(docId: string, chunks: readonly ChunkGraphIn[]): GraphError | null {
  if (!isUuid(docId)) return "ID_INVALID";
  if (chunks.length > L.chunksMax) return "TOO_MANY";
  for (const c of chunks) {
    if (!isUuid(c.chunkId)) return "ID_INVALID";
    if (c.entities.length > L.perChunkMax || c.relations.length > L.perChunkMax) return "TOO_MANY";
    const badEnt = c.entities.some(
      (e) => !validKey(e.key) || !validKey(e.name) || !validKey(e.type),
    );
    const badRel = c.relations.some(
      (r) => !validKey(r.src) || !validKey(r.dst) || !validKey(r.type),
    );
    if (badEnt || badRel) return "ENTITY_INVALID";
  }
  return null;
}

function checkLinks(rows: readonly ChunkLinkIn[]): GraphError | null {
  if (rows.length > L.linksBatchMax) return "TOO_MANY";
  const bad = rows.some(
    (r) =>
      !isUuid(r.a) ||
      !isUuid(r.b) ||
      (r.kind !== "SIMILAR" && r.kind !== "CONFLICTS") ||
      (r.score !== undefined && r.score !== null && !Number.isFinite(r.score)),
  );
  return bad ? "LINK_INVALID" : null;
}

export function graphUsecases(d: { uow: GraphUow }) {
  const run = <T>(who: Who, fn: (r: GraphRepos) => Promise<T>): Promise<T> => d.uow.tenant(who, fn);
  return {
    /** `upsert_document` (phần đồ thị): MENTIONS + Entity + REL của các đoạn đã có (N4 `knowledge.add` ghi đoạn). */
    async attach(who: Who, docId: string, chunks: readonly ChunkGraphIn[]): Promise<GResult<null>> {
      const bad = checkAttach(docId, chunks);
      if (bad) return fail(bad);
      await run(who, (r) => r.graph.attach(docId, chunks));
      return ok(null);
    },
    async linkDocuments(
      who: Who,
      docId: string,
      uris: readonly string[],
    ): Promise<GResult<number>> {
      if (!isUuid(docId)) return fail("ID_INVALID");
      if (uris.length > L.urisMax) return fail("TOO_MANY");
      if (uris.length === 0) return ok(0);
      return ok(await run<number>(who, (r) => r.graph.linkDocuments(docId, uris)));
    },
    async expand(
      who: Who,
      keys: readonly string[],
      exclude: readonly string[] = [],
      limit?: unknown,
    ): Promise<GResult<string[]>> {
      const bad = checkKeys(keys) ?? checkIds(exclude, L.excludeMax);
      if (bad) return fail(bad);
      if (keys.length === 0) return ok([]);
      const n = clampInt(limit, 1, L.expandMax, L.expandDefault);
      return ok(await run<string[]>(who, (r) => r.graph.expand(keys, exclude, n)));
    },
    async hasAlias(who: Who, a: string, b: string): Promise<GResult<boolean>> {
      if (!validKey(a) || !validKey(b)) return fail("KEY_INVALID");
      return ok(await run<boolean>(who, (r) => r.graph.hasAlias(a, b)));
    },
    async addAlias(who: Who, a: string, b: string): Promise<GResult<boolean>> {
      if (!validKey(a) || !validKey(b)) return fail("KEY_INVALID");
      if (a === b) return ok(false);
      return ok(await run<boolean>(who, (r) => r.graph.addAlias(a, b)));
    },
    /** `add_similar` / `add_conflict` theo lô (similar.py gọi từng cặp trong vòng lặp — ở đây một câu cho cả lô). */
    async addLinks(who: Who, rows: readonly ChunkLinkIn[]): Promise<GResult<number>> {
      const bad = checkLinks(rows);
      if (bad) return fail(bad);
      if (rows.length === 0) return ok(0);
      return ok(await run<number>(who, (r) => r.graph.addLinks(rows)));
    },
    async similarDocuments(
      who: Who,
      docId: string,
      limit?: unknown,
    ): Promise<GResult<SimilarRow[]>> {
      if (!isUuid(docId)) return fail("ID_INVALID");
      const n = clampInt(limit, 1, L.similarMax, L.similarDefault);
      return ok(await run<SimilarRow[]>(who, (r) => r.graph.similarDocuments(docId, n)));
    },
    async neighbourhood(who: Who, docId: string): Promise<GResult<Graph>> {
      if (!isUuid(docId)) return fail("ID_INVALID");
      const rows = await d.uow.tenant(who, (r) => r.graph.neighbourhood(docId));
      return ok(toNeighbourhood(docId, rows));
    },
    async corpus(who: Who, minShared?: unknown, limit?: unknown): Promise<GResult<Graph>> {
      const min = clampInt(minShared, 1, 100, 2);
      const n = clampInt(limit, 1, L.corpusMax, L.corpusDefault);
      const rows = await d.uow.tenant(who, (r) => r.graph.corpus(min, n));
      return ok(toCorpus(rows));
    },
    async stats(who: Who): Promise<GResult<GraphStats>> {
      return ok(await run<GraphStats>(who, (r) => r.graph.stats()));
    },
    async conflicts(who: Who, limit?: unknown): Promise<GResult<ConflictRow[]>> {
      const n = clampInt(limit, 1, L.conflictsMax, L.conflictsDefault);
      return ok(await run<ConflictRow[]>(who, (r) => r.graph.conflicts(n)));
    },
  };
}
export type GraphService = ReturnType<typeof graphUsecases>;

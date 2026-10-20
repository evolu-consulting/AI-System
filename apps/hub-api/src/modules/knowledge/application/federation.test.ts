// R1 · tìm liên kết KnowledgeHub + rerank (giả, không mạng): gộp RRF chỉ khi nguồn ngoài có hit; nguồn lỗi / không được phép ⇒
// vẫn trả nội bộ; rerank chạy trên tập gộp, lỗi ⇒ giữ thứ tự gộp; không key (reranker null) ⇒ thứ tự FTS.
import { describe, expect, it } from "bun:test";
import { parseKhHits, stableId } from "../domain/federation.rules";
import { searchKnowledge } from "./knowledge.usecases";
import type { ExternalSource, Hit, Reranker, RetrievalStrategy } from "./ports";

const T = "7e5d0000-0000-4000-8000-000000000001";
const who = { tenantId: T, userId: null };
const hit = (id: string, score = 1): Hit => ({
  chunkId: id,
  docId: `d-${id}`,
  title: id,
  heading: "",
  clauseNo: null,
  ord: 0,
  body: `body ${id}`,
  score,
});
const fts = (ids: string[]): RetrievalStrategy => ({
  name: "fts",
  search: async (_w, _q, k) => ids.slice(0, k).map((i) => hit(i)),
});
const source = (
  o: Partial<ExternalSource> & { ids?: string[]; calls?: string[] },
): ExternalSource => ({
  name: "kh",
  allows: o.allows ?? (() => true),
  search:
    o.search ??
    (async (q) => {
      o.calls?.push(q);
      return (o.ids ?? []).map((i) => hit(i));
    }),
});

describe("R1 · searchKnowledge liên kết", () => {
  it("không nguồn ngoài, không reranker ⇒ đúng thứ tự FTS, federated []", async () => {
    const r = await searchKnowledge({ strategy: fts(["a", "b", "c"]) })(who, { query: "x", k: 2 });
    expect(r).toEqual({
      ok: true,
      value: { strategy: "fts", reranked: false, federated: [], hits: [hit("a"), hit("b")] },
    });
  });
  it("KH trả hit ⇒ gộp RRF, hit KH mang source 'kh'", async () => {
    const r = await searchKnowledge({
      strategy: fts(["a", "b"]),
      sources: [source({ ids: ["kh:1", "kh:2"] })],
    })(who, { query: "x", k: 4 });
    if (!r.ok) throw new Error(r.code);
    expect(r.value.federated).toEqual(["kh"]);
    expect(new Set(r.value.hits.map((h) => h.chunkId))).toEqual(
      new Set(["a", "b", "kh:1", "kh:2"]),
    );
    expect(r.value.hits.find((h) => h.chunkId === "kh:1")?.source).toBe("kh");
    expect(r.value.hits.find((h) => h.chunkId === "a")?.source).toBeUndefined();
  });
  it("tenant không được phép ⇒ không gọi KH", async () => {
    const calls: string[] = [];
    const r = await searchKnowledge({
      strategy: fts(["a"]),
      sources: [source({ allows: () => false, calls, ids: ["kh:1"] })],
    })(who, { query: "x", k: 3 });
    expect(calls).toEqual([]);
    expect(r.ok && r.value.federated).toEqual([]);
  });
});

describe("R1 · searchKnowledge liên kết (tiếp)", () => {
  it("KH lỗi ⇒ log knowledge-source-failed, vẫn trả nội bộ theo thứ tự FTS", async () => {
    const logs: string[] = [];
    const r = await searchKnowledge({
      strategy: fts(["a", "b"]),
      sources: [source({ search: async () => Promise.reject(new TypeError("boom")) })],
      log: (m) => logs.push(m),
    })(who, { query: "x", k: 2 });
    expect(r.ok && r.value.hits.map((h) => h.chunkId)).toEqual(["a", "b"]);
    expect(logs).toEqual(["knowledge-source-failed"]);
  });
  it("rerank trên tập gộp; rerank lỗi ⇒ giữ thứ tự gộp, reranked false", async () => {
    const seen: string[][] = [];
    const rev: Reranker = {
      rerank: async ({ hits: hs, k }) => {
        seen.push(hs.map((h) => h.chunkId));
        return [...hs].reverse().slice(0, k);
      },
    };
    const deps = { strategy: fts(["a"]), sources: [source({ ids: ["kh:1"] })] };
    const r = await searchKnowledge({ ...deps, reranker: rev })(who, { query: "x", k: 2 });
    expect(seen[0]?.sort()).toEqual(["a", "kh:1"]);
    expect(r.ok && r.value.reranked).toBe(true);
    const bad: Reranker = { rerank: async () => Promise.reject(new Error("x")) };
    const r2 = await searchKnowledge({ ...deps, reranker: bad })(who, { query: "x", k: 2 });
    expect(r2.ok && r2.value.reranked).toBe(false);
    expect(r2.ok && r2.value.hits.length).toBe(2);
  });
});

describe("R1 · parseKhHits", () => {
  it("bỏ hit sai dạng, sắp score giảm, id `kh:` ổn định, cắt k", () => {
    const body = {
      hits: [
        { score: 0.2, source_text: "  thấp  " },
        { score: 0.9, source_text: "cao", id: "x1", title: "ADR 12" },
        { score: "1", source_text: "sai kiểu" },
        { score: 0.5, source_text: "   " },
        null,
      ],
    };
    const out = parseKhHits(body, 5);
    expect(out.map((h) => [h.chunkId, h.body, h.title])).toEqual([
      ["kh:x1", "cao", "ADR 12"],
      [`kh:${stableId("thấp")}`, "thấp", "KnowledgeHub"],
    ]);
    expect(parseKhHits(body, 1).length).toBe(1);
    expect(parseKhHits({ nope: 1 }, 5)).toEqual([]);
    expect(parseKhHits(null, 5)).toEqual([]);
  });
});

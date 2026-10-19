// N4-FR-03 · N4-FR-04 · N4-FR-06 · use case trên cổng giả (không DB): kiểm đầu vào, chống trùng, embedding theo lô + hạ cấp,
// rerank lỗi ⇒ giữ thứ tự FTS, get id sai dạng.
import { describe, expect, it } from "bun:test";
import { addDocument, getKnowledge, searchKnowledge } from "./knowledge.usecases";
import type { Embedder, Hit, KnowledgeRepo, KnowledgeUow, NewChunk, NewDoc } from "./ports";
import { ftsStrategy } from "./strategies";

const who = { tenantId: "7e5d0000-0000-4000-8000-000000000001", userId: null };
const hit = (n: number): Hit => ({
  chunkId: `c${n}`,
  docId: "d",
  title: "T",
  heading: "",
  clauseNo: null,
  ord: n,
  body: `đoạn ${n}`,
  score: 10 - n,
});

function fakeUow() {
  const docs: { doc: NewDoc; chunks: readonly NewChunk[] }[] = [];
  const emb: { model: string; n: number }[] = [];
  const calls: { terms: string[] }[] = [];
  const repo: KnowledgeRepo = {
    findByHash: async (h) => {
      const d = docs.find((x) => x.doc.contentHash === h);
      return d ? { id: d.doc.id, chunkCount: d.chunks.length } : null;
    },
    insert: async (doc, chunks) => {
      docs.push({ doc, chunks });
    },
    getChunk: async (id) => (id === "7e5d0000-0000-4000-8000-0000000000c1" ? hit(1) : null),
    getDocument: async () => null,
    searchFts: async (terms, o) => {
      calls.push({ terms: terms.map((t) => t.term) });
      return [hit(0), hit(1), hit(2)].slice(0, o.limit);
    },
    insertEmbeddings: async (model, rows) => {
      emb.push({ model, n: rows.length });
    },
    searchVector: async () => [],
  };
  const uow: KnowledgeUow = { tenant: (_w, fn) => fn({ knowledge: repo }) };
  return { uow, docs, emb, calls };
}

let seq = 0;
const deps = (uow: KnowledgeUow, embedder?: Embedder) => ({
  uow,
  newId: () => `7e5d0000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  sha256: (s: string) => String(s.length).padStart(64, "0"),
  embedder: embedder ?? null,
  embedBatch: 2,
});

describe("N4-FR-04 · addDocument", () => {
  it("kiểm đầu vào: tiêu đề rỗng, nội dung rỗng, kind lạ, uri có khoảng trắng", async () => {
    const add = addDocument(deps(fakeUow().uow));
    expect(await add(who, { title: " ", content: "x" })).toEqual({
      ok: false,
      code: "TITLE_INVALID",
    });
    expect(await add(who, { title: "T", content: " " })).toEqual({
      ok: false,
      code: "CONTENT_EMPTY",
    });
    expect(await add(who, { title: "T", content: "x", kind: "pdf" })).toEqual({
      ok: false,
      code: "KIND_INVALID",
    });
    expect(await add(who, { title: "T", content: "x", uri: "a b" })).toEqual({
      ok: false,
      code: "URI_INVALID",
    });
  });
  it("chia đoạn hợp đồng, ghi MỘT lần; cùng nội dung ⇒ duplicate, không ghi lại", async () => {
    const f = fakeUow();
    const add = addDocument(deps(f.uow));
    const md = "Số: 01/2026\n**Điều 1. Hàng**\nThùng\n**Điều 2. Thời hạn**\n31/12/2026";
    const a = await add(who, { title: "HĐ", content: md, kind: "contract" });
    const b = await add(who, { title: "HĐ", content: md, kind: "contract" });
    expect(a.ok && a.value.chunks).toBe(3);
    expect(b.ok && b.value.duplicate).toBe(true);
    expect(f.docs.length).toBe(1);
    expect(f.docs[0]?.chunks.map((c) => c.ord)).toEqual([0, 1, 2]);
  });
  it("embedding theo lô (2/lô ⇒ 2 lời gọi cho 3 đoạn), ghi một lần; embedder lỗi ⇒ vẫn thêm được, embedded 0", async () => {
    const f = fakeUow();
    let calls = 0;
    const ok: Embedder = {
      model: "m",
      embed: async (t) => {
        calls++;
        return t.map(() => [1, 0]);
      },
    };
    const md = "Số: 01\n**Điều 1. A**\na\n**Điều 2. B**\nb";
    const r = await addDocument(deps(f.uow, ok))(who, {
      title: "X",
      content: md,
      kind: "contract",
    });
    expect({ embedded: r.ok && r.value.embedded, calls, writes: f.emb }).toEqual({
      embedded: 3,
      calls: 2,
      writes: [{ model: "m", n: 3 }],
    });
    const bad: Embedder = { model: "m", embed: async () => Promise.reject(new Error("net")) };
    const r2 = await addDocument(deps(fakeUow().uow, bad))(who, {
      title: "Y",
      content: "nội dung",
    });
    expect(r2.ok && r2.value.embedded).toBe(0);
  });
});

describe("N4-FR-03 · searchKnowledge", () => {
  it("k kẹp [1,20], truy vấn rỗng bị từ chối, câu chỉ có từ dừng ⇒ 0 kết quả (không gọi SQL)", async () => {
    const f = fakeUow();
    const s = searchKnowledge({ strategy: ftsStrategy(f.uow) });
    expect(await s(who, { query: "  " })).toEqual({ ok: false, code: "QUERY_EMPTY" });
    const r = await s(who, { query: "thanh toán", k: 99 });
    expect(r.ok && r.value.hits.length).toBe(3);
    const none = await s(who, { query: "là gì?" });
    expect(none.ok && none.value.hits).toEqual([]);
    expect(f.calls.length).toBe(1);
  });
  it("rerank sắp lại; rerank ném ⇒ giữ thứ tự FTS, reranked=false", async () => {
    const f = fakeUow();
    const rev = searchKnowledge({
      strategy: ftsStrategy(f.uow),
      reranker: { rerank: async (_q, h, k) => [...h].reverse().slice(0, k) },
    });
    const r = await rev(who, { query: "hợp đồng", k: 2 });
    expect(r.ok && r.value.hits.map((h) => h.chunkId)).toEqual(["c2", "c1"]);
    const broken = searchKnowledge({
      strategy: ftsStrategy(f.uow),
      reranker: { rerank: async () => Promise.reject(new Error("x")) },
    });
    const b = await broken(who, { query: "hợp đồng", k: 2 });
    expect(b.ok && { re: b.value.reranked, ids: b.value.hits.map((h) => h.chunkId) }).toEqual({
      re: false,
      ids: ["c0", "c1"],
    });
  });
});

describe("N4-FR-06 · getKnowledge", () => {
  it("id sai dạng ⇒ ID_INVALID; không thấy ⇒ null; thấy đoạn ⇒ chunk", async () => {
    const get = getKnowledge({ uow: fakeUow().uow });
    expect(await get(who, "x")).toEqual({ ok: false, code: "ID_INVALID" });
    expect(await get(who, "7e5d0000-0000-4000-8000-000000000999")).toEqual({
      ok: true,
      value: null,
    });
    const r = await get(who, "7e5d0000-0000-4000-8000-0000000000c1");
    expect(r.ok && r.value?.kind).toBe("chunk");
  });
});

// R1 · review CR-095 đợt C · F-05: văn bản > trần kho (500k ký tự) ⇒ nạp được, cắt + cảnh báo `truncated` (trước: chuyển xong rồi
// CONTENT_TOO_LARGE). F-06: tài liệu đã lưu mà CHƯA có đồ thị (lần nạp trước sập/LLM lỗi sau khi commit) ⇒ nạp lại dựng đồ thị;
// đã có ⇒ không dựng lại (graph null, không gọi LLM).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { fakeGraphAi } from "../../../apps/hub-api/src/modules/knowledge/adapters/graph-ai.adapters";
import type { GraphAi } from "../../../apps/hub-api/src/modules/knowledge/application/ports";
import {
  ingestService,
  knowledgeService,
} from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const A = tenantId(987);
const U = userId(987);
const who = { tenantId: A, userId: U };
const enc = (s: string) => new TextEncoder().encode(s);
const NOTE =
  "# Dự án Hermes\nTrần Bình phụ trách dự án Hermes. Hạn bàn giao kho Thủ Đức là ngày 20 tháng 12, ngân sách 300 triệu đồng.";

let db: Db;
let owner: Sql;
let extractCalls = 0;
const countingAi: GraphAi = {
  ...fakeGraphAi(),
  extract: async (w, t) => {
    extractCalls++;
    return fakeGraphAi().extract(w, t);
  },
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(1);
  db = createDb(urls().hubApi, { max: 2 });
});
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

describe("R1 · F-05 / F-06 nạp tệp", () => {
  it("F-05: Markdown 600k ký tự ⇒ nạp được, ≤ 500k ký tự lưu, cảnh báo truncated", async () => {
    const ingest = ingestService(db, { env: {}, graphAi: null });
    const para = (i: number) => `## Mục ${i}\n${"nội dung kho hàng ".repeat(55)}\n\n`;
    const md = Array.from({ length: 600 }, (_, i) => para(i)).join("");
    expect(md.length).toBeGreaterThan(500_000);
    const out = ok(await ingest(who, { filename: "lon.md", bytes: enc(md) }));
    expect(out.warnings).toContain("truncated");
    expect(out.duplicate).toBe(false);
    const [c] = await owner<{ n: number }[]>`
      select coalesce(sum(length(body)), 0)::int as n from knowledge.chunks where doc_id = ${out.documentId}::uuid`;
    expect(c?.n ?? 0).toBeGreaterThan(0);
    expect(c?.n ?? 0).toBeLessThanOrEqual(500_000);
  });

  it("F-06: tài liệu có sẵn chưa có đồ thị ⇒ nạp lại dựng đồ thị; lần sau không dựng lại", async () => {
    const svc = knowledgeService(db, {
      env: {},
      ai: { embedder: null, reranker: null },
      sources: [],
    });
    const first = ok(await svc.add(who, { title: "hermes", content: NOTE, kind: "markdown" }));
    const ingest = ingestService(db, { env: {}, graphAi: countingAi, svc });
    const again = ok(await ingest(who, { filename: "hermes.md", bytes: enc(NOTE) }));
    expect(again).toMatchObject({ documentId: first.documentId, duplicate: true });
    expect(again.graph?.entities ?? 0).toBeGreaterThan(0);
    expect(again.graph?.failed).toEqual([]);
    const [m] = await owner<
      { n: number }[]
    >`select count(*)::int as n from knowledge.chunk_entities ce
      join knowledge.chunks c on c.id = ce.chunk_id where c.doc_id = ${first.documentId}::uuid`;
    expect(m?.n ?? 0).toBeGreaterThan(0);
    const calls = extractCalls;
    const third = ok(await ingest(who, { filename: "hermes.md", bytes: enc(NOTE) }));
    expect(third).toMatchObject({ documentId: first.documentId, duplicate: true, graph: null });
    expect(extractCalls).toBe(calls);
  });
});

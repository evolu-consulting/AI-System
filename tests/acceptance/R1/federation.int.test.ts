// R1 · `knowledge-search` liên kết KnowledgeHub trên DB thật + KH giả (Bun.serve loopback): bật bằng env `KNOWLEDGE_KH_*`;
// kết quả gộp nội bộ + KH (source "kh"), khoá chỉ ở header; tenant ngoài danh sách không gọi KH; KH sập ⇒ vẫn trả nội bộ;
// không cấu hình ⇒ không gọi mạng. Rerank giả (đảo thứ tự) chạy trên tập gộp.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { knowledgeTools } from "../../../apps/hub-api/src/modules/knowledge/adapters/knowledge.tools";
import type { Reranker } from "../../../apps/hub-api/src/modules/knowledge/application/ports";
import { knowledgeService } from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const A = tenantId(991);
const B = tenantId(992);
const U = userId(991);
const KEY = "kh-fake-key-r1";
const calls: { key: string | null; body: { text: string; project: string } }[] = [];
let kh: ReturnType<typeof Bun.serve>;
let down = false;
let db: Db;

const env = (extra: Record<string, string> = {}) => ({
  APP_ENV: "test",
  KNOWLEDGE_KH_URL: `http://127.0.0.1:${kh.port}`,
  KNOWLEDGE_KH_KEY: KEY,
  KNOWLEDGE_KH_PROJECT: "evolu",
  KNOWLEDGE_KH_TENANTS: A,
  ...extra,
});
const NO_AI = { embedder: null, reranker: null };
type Out = {
  federated: string[];
  reranked: boolean;
  hits: { id: string; text: string; source?: string }[];
};
const run = async (svc: ReturnType<typeof knowledgeService>, t: string, query: string) => {
  const tool = knowledgeTools(svc).find((x) => x.name === "knowledge-search");
  return (await tool?.run({ tenantId: t, userId: U, runId: null }, { query, k: 6 })) as Out;
};

beforeAll(async () => {
  kh = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const body = (await req.json()) as { text: string; project: string };
      calls.push({ key: req.headers.get("x-kh-key"), body });
      if (down) return new Response("down", { status: 503 });
      if (new URL(req.url).pathname !== "/vector/query") return new Response("nf", { status: 404 });
      return Response.json({
        hits: [
          {
            score: 0.91,
            id: "adr21",
            title: "ADR-0021",
            source_text: "Dịch vụ tri thức gộp hai RAG: kho hợp đồng và KnowledgeHub.",
          },
          { score: 0.42, source_text: "Ghi chú KH: thời hạn thanh toán chuẩn 45 ngày." },
        ],
      });
    },
  });
  await cloneDb("full");
  db = createDb(urls().hubApi, { max: 2 });
  const local = knowledgeService(db, { env: {}, ai: NO_AI, sources: [] });
  for (const t of [A, B])
    await local.add(
      { tenantId: t, userId: U },
      {
        title: "HĐ mua bán",
        content:
          "# Điều 3. Thanh toán\nBên A thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn.",
      },
    );
});
afterAll(async () => {
  kh?.stop(true);
  await db?.close();
});

describe("R1 · liên kết KnowledgeHub (KH giả)", () => {
  it("tenant được phép: gộp nội bộ + KH, hit KH mang source 'kh', khoá chỉ ở header X-KH-Key", async () => {
    calls.length = 0;
    const out = await run(
      knowledgeService(db, { env: env(), ai: NO_AI }),
      A,
      "thời hạn thanh toán",
    );
    expect(out.federated).toEqual(["kh"]);
    expect(out.hits.some((h) => h.source === "kh" && h.id === "kh:adr21")).toBe(true);
    expect(out.hits.some((h) => h.source === undefined && h.text.includes("30 ngày"))).toBe(true);
    expect(calls).toEqual([
      {
        key: KEY,
        body: expect.objectContaining({ text: "thời hạn thanh toán", project: "evolu" }),
      },
    ]);
  });
  it("tenant ngoài KNOWLEDGE_KH_TENANTS ⇒ không gọi KH, chỉ nội bộ của chính tenant", async () => {
    calls.length = 0;
    const out = await run(
      knowledgeService(db, { env: env(), ai: NO_AI }),
      B,
      "thời hạn thanh toán",
    );
    expect(calls).toEqual([]);
    expect(out.federated).toEqual([]);
    expect(out.hits.every((h) => h.source === undefined)).toBe(true);
  });
  it("KH sập (503) ⇒ vẫn trả kết quả nội bộ, federated rỗng", async () => {
    down = true;
    const out = await run(
      knowledgeService(db, { env: env(), ai: NO_AI }),
      A,
      "thời hạn thanh toán",
    );
    down = false;
    expect(out.federated).toEqual([]);
    expect(out.hits[0]?.text).toContain("30 ngày");
  });
  it("không cấu hình KH ⇒ không gọi mạng", async () => {
    calls.length = 0;
    await run(knowledgeService(db, { env: { APP_ENV: "test" }, ai: NO_AI }), A, "thanh toán");
    expect(calls).toEqual([]);
  });
  it("rerank (giả) chạy trên tập gộp nội bộ + KH", async () => {
    const seen: string[][] = [];
    const reranker: Reranker = {
      rerank: async ({ hits: hs, k }) => {
        seen.push(hs.map((h) => h.source ?? "local"));
        return [...hs].reverse().slice(0, k);
      },
    };
    const out = await run(
      knowledgeService(db, { env: env(), ai: { embedder: null, reranker } }),
      A,
      "thanh toán",
    );
    expect(out.reranked).toBe(true);
    expect(new Set(seen[0])).toEqual(new Set(["local", "kh"]));
  });
});

// N4-FR-03 · N4-FR-04 · N4-FR-06 · N4-AC01…04 · ADR-0021 §2 + Hệ quả: tool `knowledge-search/get/add` trên DB thật (role
// `knowledge_rw`, RLS FORCE) — cách ly tenant (không lộ đoạn nào, thăm dò id chéo ≡ không có), truy vấn thiếu/sai tenant bị
// từ chối TRƯỚC khi mở tx, số câu SQL mỗi lần tìm cố định (1 câu + tx), tool đăng ký được vào registry tool gói (`/mcp`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { countStatements } from "@ai/test-kit/perf";
import { knowledgeTools } from "../../../apps/hub-api/src/modules/knowledge/adapters/knowledge.tools";
import { knowledgeService } from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";
import { PackToolRegistry } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-tools.registry";

const A = tenantId(951);
const B = tenantId(952);
const U = userId(951);
const ctx = (t: string) => ({ tenantId: t, userId: U, runId: null });
const NO_AI = { embedder: null, reranker: null };

const HD_A = `# HỢP ĐỒNG MUA BÁN\nSố: 01/2026/HĐMB-PN\n**BÊN BÁN (Bên B): Bao Bì Phương Nam**\n**Điều 1. Hàng hóa**\nThùng carton 5 lớp CT5L-60 đơn giá 8.500 đồng.\n**Điều 3. Thanh toán**\nBên A thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn.`;
const HD_B = `# HỢP ĐỒNG MUA BÁN\nSố: 99/2026/HĐMB-CANARY\n**BÊN BÁN (Bên B): Canary Bí Mật**\n**Điều 1. Hàng hóa**\nThùng carton 5 lớp CT5L-60 đơn giá 7.700 đồng. CANARY-SECRET-7731\n**Điều 3. Thanh toán**\nThanh toán trong 120 ngày.`;

let db: Db;
let tools: ReturnType<typeof knowledgeTools>;
const tool = (name: string) => tools.find((t) => t.name === name) as (typeof tools)[number];
const run = (name: string, t: string, args: Record<string, string | number>) =>
  tool(name).run(ctx(t), args);
let docA = "";
let chunkB = "";

beforeAll(async () => {
  await cloneDb("full");
  db = createDb(urls().hubApi, { max: 2 });
  tools = knowledgeTools(knowledgeService(db, { env: {}, ai: NO_AI }));
  docA = String(
    (await run("knowledge-add", A, { title: "HĐ Phương Nam", content: HD_A, kind: "contract" }))
      .document_id,
  );
  await run("knowledge-add", B, { title: "HĐ Canary", content: HD_B, kind: "contract" });
  const s = (await run("knowledge-search", B, { query: "CANARY-SECRET-7731", k: 1 })) as {
    hits: { id: string }[];
  };
  chunkB = s.hits[0]?.id ?? "";
});
afterAll(async () => {
  await db?.close();
});

type Out = {
  strategy: string;
  hits: { id: string; document_id: string; title: string; text: string }[];
};

describe("N4-AC01 · cách ly tenant", () => {
  it("N4-AC01 · cùng câu hỏi: A chỉ thấy đoạn của A, B chỉ thấy của B; chuỗi bí mật của B không bao giờ về A", async () => {
    const q = { query: "đơn giá thùng carton CT5L-60 CANARY-SECRET-7731", k: 20 };
    const a = (await run("knowledge-search", A, q)) as Out;
    const b = (await run("knowledge-search", B, q)) as Out;
    expect(a.hits.length).toBeGreaterThan(0);
    expect(a.hits.every((h) => h.document_id === docA)).toBe(true);
    expect(JSON.stringify(a).includes("CANARY")).toBe(false);
    expect(b.hits.some((h) => h.text.includes("CANARY-SECRET-7731"))).toBe(true);
    expect(b.hits.some((h) => h.document_id === docA)).toBe(false);
  });
  it("N4-AC02 · thăm dò id: knowledge-get id đoạn của B dưới A ≡ id không tồn tại (found:false)", async () => {
    expect(chunkB).not.toBe("");
    expect(await run("knowledge-get", A, { id: chunkB })).toEqual({ found: false });
    expect(await run("knowledge-get", A, { id: "7e5d0000-0000-4000-8000-00000000dead" })).toEqual({
      found: false,
    });
    expect(((await run("knowledge-get", B, { id: chunkB })) as { found: boolean }).found).toBe(
      true,
    );
  });
  it("N4-AC03 · thiếu/sai tenant ⇒ bị từ chối trước khi mở tx (PackScopeError TENANT_INVALID)", async () => {
    for (const t of ["", "not-a-uuid"])
      await expect(run("knowledge-search", t, { query: "thùng carton" })).rejects.toThrow(
        "TENANT_INVALID",
      );
  });
});

describe("N4-FR-03/04/06 · hành vi tool", () => {
  it("knowledge-search tìm không dấu ≡ có dấu; đoạn đúng điều khoản lên đầu", async () => {
    const a = (await run("knowledge-search", A, {
      query: "thoi han thanh toan bao nhieu ngay",
      k: 3,
    })) as Out;
    const b = (await run("knowledge-search", A, {
      query: "Thời hạn thanh toán bao nhiêu ngày",
      k: 3,
    })) as Out;
    expect(a.hits.map((h) => h.id)).toEqual(b.hits.map((h) => h.id));
    expect(a.hits[0]?.text).toContain("30 ngày");
    expect(a.strategy).toBe("fts");
  });
  it("knowledge-add cùng nội dung ⇒ duplicate, cùng document_id; knowledge-get id tài liệu ⇒ mọi đoạn theo thứ tự", async () => {
    const again = await run("knowledge-add", A, {
      title: "HĐ Phương Nam",
      content: HD_A,
      kind: "contract",
    });
    expect(again).toMatchObject({ document_id: docA, duplicate: true });
    const doc = (await run("knowledge-get", A, { id: docA })) as {
      document: { chunks: { heading: string }[] };
    };
    expect(doc.document.chunks.length).toBe(3);
  });
  it("đầu vào sai ⇒ tool ném mã ổn định (registry ⇒ UPSTREAM_ERROR)", async () => {
    await expect(run("knowledge-search", A, { query: "  " })).rejects.toThrow("QUERY_EMPTY");
    await expect(run("knowledge-get", A, { id: "x" })).rejects.toThrow("ID_INVALID");
  });
  it("Luật 4c · knowledge-search = số câu SQL cố định (không phụ thuộc số term/đoạn)", async () => {
    const client = (db.db as unknown as { $client: Sql }).$client;
    const short = await countStatements(client, () =>
      run("knowledge-search", A, { query: "carton" }),
    );
    const long = await countStatements(client, () =>
      run("knowledge-search", A, {
        query: "đơn giá thùng carton 5 lớp CT5L-60 thanh toán hóa đơn Phương Nam",
        k: 20,
      }),
    );
    expect({ short, long }).toEqual({ short: 2, long: 2 }); // set_config role/tenant + 1 câu tìm
  });
  it("tool đăng ký vào registry gói với khoá knowledge-search/get/add, không side_effect, quyền read/read/write", () => {
    const reg = new PackToolRegistry();
    for (const t of tools) reg.register(t);
    expect(
      ["knowledge-search", "knowledge-get", "knowledge-add"].map((k) => reg.info(k)?.sideEffect),
    ).toEqual([false, false, false]);
    expect(tools.map((t) => t.action)).toEqual(["read", "read", "write"]);
  });
});

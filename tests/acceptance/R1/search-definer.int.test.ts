// R1 · N4-FR-05 · N4-NFR-01: `knowledge.search_idf` (SECURITY DEFINER, role đọc `knowledge_search`) giữ cách ly tenant như RLS.
// Tenant chỉ từ `app.tenant_id` của tx (không có tham số tenant); thiếu ⇒ 42501; df/IDF của A không bị đoạn của B làm lệch
// (A không suy được df của B); search_path ghim; chỉ `knowledge_rw` được EXECUTE; trigger giữ df khi thêm/xoá.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { asRole, cloneDb, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { knowledgeService } from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const A = tenantId(971);
const B = tenantId(972);
const U = userId(971);
const NO_AI = { embedder: null, reranker: null };
const TERMS = JSON.stringify([{ term: "zebrakhoa", w: 1 }]);

let db: Db;
let owner: Sql;
let svc: ReturnType<typeof knowledgeService>;
const add = (t: string, title: string, content: string) =>
  svc.add({ tenantId: t, userId: U }, { title, content, kind: "markdown" });
const searchA = async (query: string) => {
  const r = await svc.search({ tenantId: A, userId: U }, { query, k: 10 });
  if (!r.ok) throw new Error(r.code);
  return r.value.hits;
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(1);
  db = createDb(urls().hubApi, { max: 2 });
  svc = knowledgeService(db, { env: {}, ai: NO_AI });
  await add(A, "Tài liệu A", "# Mục 1\nzebrakhoa xuất hiện một lần trong tài liệu của A.");
  await add(A, "Tài liệu A2", "# Mục 2\nthông tin khác của A về kho hàng.");
});
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("R1 · search_idf DEFINER — cách ly tenant", () => {
  it("chữ ký không có tham số tenant; search_path ghim; DEFINER; chỉ knowledge_rw có EXECUTE (PUBLIC không)", async () => {
    const [f] = await owner<{ args: string; cfg: string[]; definer: boolean; owner: string }[]>`
      select pg_get_function_identity_arguments(p.oid) as args, p.proconfig as cfg, p.prosecdef as definer,
        pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'knowledge' and p.proname = 'search_idf'`;
    expect(f?.args).toBe("p_terms jsonb, p_limit integer, p_cand integer");
    expect(f?.definer).toBe(true);
    expect(f?.owner).toBe("knowledge_search");
    expect(f?.cfg).toContain("search_path=pg_catalog, pg_temp");
    const [g] = await owner<{ rw: boolean; api: boolean; hub: boolean }[]>`select
      has_function_privilege('knowledge_rw', 'knowledge.search_idf(jsonb, integer, integer)', 'execute') as rw,
      has_function_privilege('knowledge_api', 'knowledge.search_idf(jsonb, integer, integer)', 'execute') as api,
      has_function_privilege('hub_api', 'knowledge.search_idf(jsonb, integer, integer)', 'execute') as hub`;
    expect(g).toEqual({ rw: true, api: false, hub: false });
    const [r] = await owner<{ login: boolean; bypass: boolean }[]>`
      select rolcanlogin as login, rolbypassrls as bypass from pg_roles where rolname = 'knowledge_search'`;
    expect(r).toEqual({ login: false, bypass: false });
  });

  it("tx thiếu app.tenant_id ⇒ 42501 (đóng khi lỗi), không trả hàng", async () => {
    const code = await pgCode(() =>
      asRole(
        "knowledge_rw",
        null,
        (tx) => tx`select * from knowledge.search_idf(${TERMS}::text::jsonb, 5)`,
      ),
    );
    expect(code).toBe("42501");
  });

  it("A không thấy đoạn của B và df/IDF của A không đổi khi B nạp 30 đoạn cùng từ (A không suy được df của B)", async () => {
    const before = await searchA("zebrakhoa");
    expect(before.length).toBe(1);
    for (let i = 0; i < 30; i++)
      await add(B, `Tài liệu B${i}`, `# B ${i}\nzebrakhoa bí mật của B số ${i}. CANARY-B-${i}`);
    const after = await searchA("zebrakhoa");
    expect(after.map((h) => h.chunkId)).toEqual(before.map((h) => h.chunkId));
    expect(after[0]?.score).toEqual(before[0]?.score);
    expect(JSON.stringify(after).includes("CANARY-B")).toBe(false);
    // df trong bảng: A = 1, B = 30, và knowledge_rw của A chỉ đọc được hàng của A
    const rows = await asRole(
      "knowledge_rw",
      A,
      (tx) =>
        tx<
          { tenant_id: string; df: number }[]
        >`select tenant_id::text, df from knowledge.lexemes where lexeme = 'zebrakhoa'`,
    );
    expect(rows).toEqual([{ tenant_id: A, df: 1 }]);
    const [b] = await owner<{ df: number }[]>`
      select df from knowledge.lexemes where tenant_id = ${B}::uuid and lexeme = 'zebrakhoa'`;
    expect(b?.df).toBe(30);
  });

  it("trigger trừ df khi xoá tài liệu (cascade đoạn)", async () => {
    await owner`delete from knowledge.documents where tenant_id = ${B}::uuid and title = 'Tài liệu B0'`;
    const [b] = await owner<{ df: number }[]>`
      select df from knowledge.lexemes where tenant_id = ${B}::uuid and lexeme = 'zebrakhoa'`;
    expect(b?.df).toBe(29);
  });
});

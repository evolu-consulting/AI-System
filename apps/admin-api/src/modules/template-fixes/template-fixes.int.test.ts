// CR-125 · c5b · int (admin-api thật, RLS admin_api): `POST /admin/tenants/:id/template-fixes/{enable-feature,create-group}`.
// Quyền: chỉ platform_admin (tenant_admin ⇒ 403, kể cả công ty của chính mình). Cách ly: chỉ đúng công ty trong đường dẫn đổi, công ty khác
// nguyên trạng. Audit: có dòng grant/create đúng công ty. Dùng đúng service entitlement/group (cùng audit + khoá).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createM4Env, type M4Env, TENANT_ID } from "../../../../../tests/acceptance/M4/_ab";

let env: M4Env;
beforeAll(async () => {
  env = await createM4Env();
}, 60_000);
afterAll(async () => {
  await env?.close();
});

const platform = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const A = TENANT_ID.acme;
const B = TENANT_ID.globex;
const fix = (t: string, what: string) => `/admin/tenants/${t}/template-fixes/${what}`;

describe("c5b · sửa nhanh cho mẫu Thư viện (platform_admin)", () => {
  it("enable-feature: bật cho đúng công ty A (audit grant), B nguyên trạng; khoá lạ 404; chạy lại vô hại", async () => {
    const [f] = await env.owner<
      { id: string; key: string }[]
    >`select id::text as id, key from admin.features where key <> 'core' order by key limit 1`;
    if (!f) throw new Error("fixture: không có feature");
    await env.owner`delete from admin.feature_entitlements where feature_id = ${f.id}::uuid and tenant_id in (${A}, ${B})`;
    const [{ n: seq0 } = { n: "0" }] = await env.owner<
      { n: string }[]
    >`select coalesce(max(seq), 0)::text as n from admin.audit_log`;

    const r = await platform("POST", fix(A, "enable-feature"), { feature_key: f.key });
    expect(r.status).toBe(200);
    const has = (t: string) =>
      env.owner`select 1 from admin.feature_entitlements where feature_id = ${f.id}::uuid and tenant_id = ${t} and revoked_at is null`;
    expect((await has(A)).length).toBe(1);
    expect((await has(B)).length).toBe(0); // cách ly công ty
    const audit = await env.owner<
      { tenant_id: string; action: string; entity: string }[]
    >`select tenant_id::text, action, entity from admin.audit_log where seq > ${seq0}::bigint and entity = 'entitlement'`;
    expect(audit.map((a) => ({ ...a }))).toEqual([
      { tenant_id: A, action: "grant", entity: "entitlement" },
    ]);

    expect((await platform("POST", fix(A, "enable-feature"), { feature_key: f.key })).status).toBe(
      200,
    );
    expect(
      (await platform("POST", fix(A, "enable-feature"), { feature_key: "khong-co-khoa" })).status,
    ).toBe(404);
    expect(
      (await platform("POST", fix(crypto.randomUUID(), "enable-feature"), { feature_key: f.key }))
        .status,
    ).toBe(404);
  });

  it("create-group: tạo nhóm gợi ý ở đúng công ty A (audit create), trùng mã 409, mã sai 400, B không có", async () => {
    const key = "nhom-goi-y-c5b";
    await env.owner`delete from admin.groups where key = ${key}`;
    const r = await platform("POST", fix(A, "create-group"), { group_key: key });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ key, tenant_id: A, name: { vi: "Nhom goi y c5b" } });
    const rows = await env.owner<
      { tenant_id: string }[]
    >`select tenant_id::text from admin.groups where key = ${key}`;
    expect(rows.map((x) => ({ ...x }))).toEqual([{ tenant_id: A }]);
    expect((await platform("POST", fix(A, "create-group"), { group_key: key })).status).toBe(409);
    expect(
      (await platform("POST", fix(A, "create-group"), { group_key: "Sai Dạng!" })).status,
    ).toBe(400);
    const [a] = await env.owner<
      { n: number }[]
    >`select count(*)::int as n from admin.audit_log where entity = 'group' and action = 'create' and entity_name = ${key} and tenant_id = ${A}`;
    expect(a?.n).toBe(1);
  });

  it("vai khác platform_admin (tenant_admin, kể cả công ty của mình) ⇒ 403, không đổi dữ liệu", async () => {
    const tadmin = env.by("acme", "binh");
    const [before] = await env.owner<{ n: number }[]>`select count(*)::int as n from admin.groups`;
    expect((await tadmin("POST", fix(A, "create-group"), { group_key: "tu-y-tao" })).status).toBe(
      403,
    );
    // công ty khác: từ chối (403) hoặc không lộ tồn tại (404) — đều không được ghi
    expect([403, 404]).toContain(
      (await tadmin("POST", fix(B, "create-group"), { group_key: "tu-y-tao" })).status,
    );
    expect((await tadmin("POST", fix(A, "enable-feature"), { feature_key: "x" })).status).toBe(403);
    const [after] = await env.owner<{ n: number }[]>`select count(*)::int as n from admin.groups`;
    expect(after?.n).toBe(before?.n);
  });
});

// CR-124 · q2 · FLOW4-FR-03/04/05 · NFR-04 · danh bạ công ty qua HTTP thật (RLS thật, role admin_api):
// chỉ công ty đã bật + không phải chính mình + đúng 5 cột công khai (test hợp đồng); chỉ quản trị CHÍNH công ty bật/tắt;
// chỉ quản trị nền tảng đặt "Đã xác minh" (cả API lẫn hàm DB).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { DirectorySearchResponseSchema, TenantCompanyProfileSchema } from "@ai/contracts/tenants";
import {
  createEnv,
  type Env,
  type Opts,
  TENANT_ID,
  USER_ID,
} from "../../../../../tests/acceptance/M1/_fixtures";

const ACME = TENANT_ID.acme;
const GLOBEX = TENANT_ID.globex;
const TEST_MS = 40_000;
const PUBLIC_COLUMNS = ["address", "legal_name", "tax_code", "tenant_id", "verified"];

let env: Env;
const put = (path: string, o: Opts) => env.call("PUT", path, o);
const search = (q: string, token: string) =>
  env.get(`/admin/directory?q=${encodeURIComponent(q)}`, { token });

beforeAll(async () => {
  env = await createEnv();
}, 90_000);
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  // Hồ sơ đủ tên pháp lý + MST; Globex còn có dữ liệu liên hệ — KHÔNG được lọt ra danh bạ.
  await env.owner`update admin.tenants set legal_name = 'Công ty TNHH Acme', tax_code = '0312345678',
    address = '1 Lê Lợi, Q1' where id = ${ACME}`;
  await env.owner`update admin.tenants set legal_name = 'Công ty Cổ phần Globex', tax_code = '0109876543',
    address = '9 Trần Hưng Đạo, Hà Nội', contact_email = 'bi.mat@globex.test', contact_phone = '0909 000 111'
    where id = ${GLOBEX}`;
}, 40_000);

describe("CR-124 q2 · danh bạ công ty", () => {
  it(
    "chỉ công ty đã bật, không phải chính mình, đúng bộ cột công khai (FR-03/04)",
    async () => {
      const acme = await env.token("acme", "binh");
      const globex = await env.token("globex", "hoa");
      // Globex chưa bật ⇒ Acme không thấy theo cả MST lẫn tên.
      expect((await search("0109876543", acme)).json.items).toEqual([]);
      expect((await search("globex", acme)).json.items).toEqual([]);

      const on = await put(`/admin/tenants/${GLOBEX}/directory`, {
        token: globex,
        body: { listed: true },
      });
      expect(on.status).toBe(200);
      expect(TenantCompanyProfileSchema.parse(on.json).directory_listed).toBe(true);

      const byTax = await search("0109876543", acme);
      expect(byTax.status).toBe(200);
      const parsed = DirectorySearchResponseSchema.parse(byTax.json); // strictObject: thừa cột ⇒ lỗi
      expect(parsed.items).toHaveLength(1);
      expect(Object.keys(byTax.json.items[0]).sort()).toEqual(PUBLIC_COLUMNS);
      expect(parsed.items[0]).toMatchObject({
        tenant_id: GLOBEX,
        legal_name: "Công ty Cổ phần Globex",
        tax_code: "0109876543",
        address: "9 Trần Hưng Đạo, Hà Nội",
        verified: false,
      });
      expect(byTax.text).not.toContain("bi.mat@globex.test");
      // Tên: không phân biệt hoa thường, ≥ 3 ký tự; ký tự đại diện % _ không mở rộng kết quả.
      expect((await search("GLOBEX", acme)).json.items).toHaveLength(1);
      expect((await search("%%%", acme)).json.items).toEqual([]);
      expect((await search("ab", acme)).status).toBe(400);

      // Acme bật cũng không thấy chính mình; Globex tìm Acme thấy.
      await put(`/admin/tenants/${ACME}/directory`, { token: acme, body: { listed: true } });
      expect((await search("0312345678", acme)).json.items).toEqual([]);
      expect((await search("0312345678", globex)).json.items).toHaveLength(1);

      // Tắt ⇒ biến mất.
      await put(`/admin/tenants/${GLOBEX}/directory`, { token: globex, body: { listed: false } });
      expect((await search("0109876543", acme)).json.items).toEqual([]);
    },
    TEST_MS,
  );

  it(
    "chỉ quản trị chính công ty bật/tắt, thiếu MST ⇒ 422, người thường/nền tảng/công ty khác bị chặn",
    async () => {
      const binh = await env.token("acme", "binh");
      const an = await env.token("acme", "an");
      const hoa = await env.token("globex", "hoa");
      const admin = await env.token("platform", "admin");
      const url = `/admin/tenants/${ACME}/directory`;
      const body = { listed: true };
      expect((await put(url, { token: an, body })).status).toBe(403);
      expect((await put(url, { token: admin, body })).status).toBe(403); // nền tảng không bật hộ
      expect((await put(url, { token: hoa, body })).status).toBe(404); // công ty khác
      expect((await search("0312345678", an)).status).toBe(403);
      const [r0] = await env.owner`select directory_listed from admin.tenants where id = ${ACME}`;
      expect(r0?.directory_listed).toBe(false);

      await env.owner`update admin.tenants set tax_code = null where id = ${ACME}`;
      const bad = await put(url, { token: binh, body });
      expect(bad.status).toBe(422);
      expect(bad.json.error.code).toBe("DIRECTORY_NEEDS_PROFILE");
      await env.owner`update admin.tenants set tax_code = '0312345678' where id = ${ACME}`;
      expect((await put(url, { token: binh, body })).status).toBe(200);
    },
    TEST_MS,
  );

  it(
    "chỉ quản trị nền tảng đặt Đã xác minh (API + hàm DB), hiện ngày + người xác minh, công ty vẫn thấy",
    async () => {
      const binh = await env.token("acme", "binh");
      const hoa = await env.token("globex", "hoa");
      const admin = await env.token("platform", "admin");
      const url = `/admin/tenants/${GLOBEX}/directory-verified`;
      await put(`/admin/tenants/${GLOBEX}/directory`, { token: hoa, body: { listed: true } });
      expect((await put(url, { token: hoa, body: { verified: true } })).status).toBe(403);
      expect((await put(url, { token: binh, body: { verified: true } })).status).toBe(404); // công ty khác

      const ok = await put(url, { token: admin, body: { verified: true } });
      expect(ok.status).toBe(200);
      const p = TenantCompanyProfileSchema.parse(ok.json);
      expect(p.directory_verified?.by_name).toBeTruthy();
      expect(Number.isNaN(Date.parse(p.directory_verified?.at ?? ""))).toBe(false);
      expect((await search("0109876543", binh)).json.items[0].verified).toBe(true);
      // công ty tự đọc hồ sơ thấy dấu (chỉ đọc)
      const own = await env.get(`/admin/tenants/${GLOBEX}/profile`, { token: hoa });
      expect(TenantCompanyProfileSchema.parse(own.json).directory_verified).not.toBeNull();

      // DB chặn cả khi lách API: phạm vi tenant gọi hàm ⇒ 42501.
      const code = await env.owner
        .begin(async (tx) => {
          await tx`set local role admin_api`;
          await tx`select set_config('app.scope', 'tenant', true), set_config('app.tenant_id', ${GLOBEX}, true)`;
          await tx`select admin.directory_set_verified(${GLOBEX}::uuid, false, ${USER_ID.binh}::uuid)`;
        })
        .then(() => null)
        .catch((e: { code?: string }) => e.code ?? "no-code");
      expect(code).toBe("42501");

      const off = await put(url, { token: admin, body: { verified: false } });
      expect(TenantCompanyProfileSchema.parse(off.json).directory_verified).toBeNull();
    },
    TEST_MS,
  );

  it("hàm tìm chỉ cho admin_rw, Hub/PUBLIC không chạy được, chưa đặt phạm vi ⇒ 42501", async () => {
    const [g] = await env.owner`select
      has_function_privilege('hub_ro', 'admin.directory_search(text)', 'execute') as hub_ro,
      has_function_privilege('admin_rw', 'admin.directory_search(text)', 'execute') as admin_rw`;
    expect(g).toEqual({ hub_ro: false, admin_rw: true });
    const code = await env.owner
      .begin(async (tx) => {
        await tx`set local role admin_api`;
        await tx`select * from admin.directory_search('0109876543')`;
      })
      .then(() => null)
      .catch((e: { code?: string }) => e.code ?? "no-code");
    expect(code).toBe("42501");
  });
});

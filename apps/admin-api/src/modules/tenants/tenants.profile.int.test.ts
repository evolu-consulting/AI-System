// CR-121 · GET/PATCH /admin/tenants/:id/profile qua HTTP thật (app + DB, RLS thật).
// Đường chính + chặn đọc/sửa chéo tenant + CEO không phải thành viên ⇒ 422 + GET ≤ 2 câu SQL dữ liệu.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { TenantCompanyProfileSchema } from "@ai/contracts";
import { createDb } from "@ai/db";
import { setProbe, sqlCounters } from "@ai/db/probe";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  type Opts,
  TENANT_ID,
  USER_ID,
} from "../../../../../tests/acceptance/M1/_fixtures";
import { getTenantProfile } from "./tenants.profile.service";

const ACME = TENANT_ID.acme;
const GLOBEX = TENANT_ID.globex;
const url = (id: string) => `/admin/tenants/${id}/profile`;

/** Guard mỗi bước: quá 8 s ⇒ fail NGAY kèm tên bước (tránh treo im lặng — bun 1.3.14 quay 100% CPU khi test vượt timeout). */
const STEP_MS = 8_000;
const TEST_MS = 40_000;
function guard<T>(name: string, p: PromiseLike<T>, ms = STEP_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`HANG > ${ms} ms ở bước: ${name}`)), ms);
  });
  return Promise.race([Promise.resolve(p), timeout]).finally(() => clearTimeout(t));
}
const api = {
  get: (path: string, o?: Opts) => guard(`GET ${path}`, env.get(path, o)),
  patch: (path: string, o?: Opts) => guard(`PATCH ${path}`, env.patch(path, o)),
};
let env: Env;
beforeAll(async () => {
  env = await guard("createEnv", createEnv(), 60_000);
}, 90_000);
afterAll(async () => {
  setProbe(false);
  await env.close();
});
beforeEach(() => guard("env.reset", env.reset(), 30_000), 40_000);

describe("CR-121 · hồ sơ công ty", () => {
  it(
    "đường chính: platform_admin đọc hồ sơ trống, sửa từng trường, CEO/Giám đốc + phòng ban hiện đúng, tenant_admin đọc được",
    async () => {
      const admin = await env.token("platform", "admin");
      // Một phòng ban có trưởng phòng + 2 thành viên (An, Lan) — dữ liệu riêng của test.
      await guard(
        "owner SQL",
        env.owner`insert into admin.groups (id, tenant_id, key, name) values
      ('01900000-0000-7000-8000-0000000c1001', ${ACME}, 'kinh-doanh', '{"vi":"Kinh doanh","en":"Sales"}')`,
      );
      await guard(
        "owner SQL",
        env.owner`insert into admin.departments (tenant_id, group_id, head_user_id)
      values (${ACME}, '01900000-0000-7000-8000-0000000c1001', ${USER_ID.lan})`,
      );
      await guard(
        "owner SQL",
        env.owner`insert into admin.group_members (tenant_id, group_id, user_id) values
      (${ACME}, '01900000-0000-7000-8000-0000000c1001', ${USER_ID.an}),
      (${ACME}, '01900000-0000-7000-8000-0000000c1001', ${USER_ID.lan})`,
      );

      const g0 = await api.get(url(ACME), { token: admin });
      expect(g0.status).toBe(200);
      const p0 = TenantCompanyProfileSchema.parse(g0.json);
      expect(p0.legal_name).toBeNull();
      expect(p0.ceo).toBeNull();
      expect(p0.member_count).toBeGreaterThanOrEqual(2);
      expect(p0.departments).toHaveLength(1);
      expect(p0.departments[0]).toMatchObject({
        name: { vi: "Kinh doanh" },
        member_count: 2,
        head: { id: USER_ID.lan, display_name: "Lan Tran" },
      });

      const r = await api.patch(url(ACME), {
        token: admin,
        body: {
          version: p0.version,
          legal_name: "Công ty TNHH Acme",
          tax_code: "0312345678",
          staff_size: 42,
          contact_email: "Lien.He@Acme.test",
          contact_phone: "028 3822 1234",
          ceo_user_id: USER_ID.binh,
          director_user_id: USER_ID.lan,
        },
      });
      expect(r.status).toBe(200);
      const p1 = TenantCompanyProfileSchema.parse(r.json);
      expect(p1.version).toBe(p0.version + 1);
      expect(p1).toMatchObject({
        legal_name: "Công ty TNHH Acme",
        staff_size: 42,
        contact_email: "lien.he@acme.test",
        ceo: { id: USER_ID.binh, display_name: "Binh Le" },
        director: { id: USER_ID.lan },
      });

      // Sửa đúng một trường (xoá địa chỉ chưa có + đổi quy mô); gửi lại giá trị y nguyên không tăng version.
      const same = await api.patch(url(ACME), {
        token: admin,
        body: { version: p1.version, staff_size: 42, legal_name: "Công ty TNHH Acme" },
      });
      expect(TenantCompanyProfileSchema.parse(same.json).version).toBe(p1.version);
      const clear = await api.patch(url(ACME), {
        token: admin,
        body: { version: p1.version, contact_phone: "", ceo_user_id: null },
      });
      const p2 = TenantCompanyProfileSchema.parse(clear.json);
      expect(p2).toMatchObject({ contact_phone: null, ceo: null, version: p1.version + 1 });

      // Version cũ ⇒ 409 (không ghi đè); sai email ⇒ 400.
      expect(
        (await api.patch(url(ACME), { token: admin, body: { version: p0.version, address: "X" } }))
          .status,
      ).toBe(409);
      expect(
        (
          await api.patch(url(ACME), {
            token: admin,
            body: { version: p2.version, contact_email: "x" },
          })
        ).status,
      ).toBe(400);

      // tenant_admin công ty mình đọc được (thấy dữ liệu đã lưu), nhưng không sửa được.
      const binh = await env.token("acme", "binh");
      const mine = await api.get(url(ACME), { token: binh });
      expect(mine.status).toBe(200);
      expect(TenantCompanyProfileSchema.parse(mine.json).legal_name).toBe("Công ty TNHH Acme");
      expect(
        (await api.patch(url(ACME), { token: binh, body: { version: p2.version, address: "Z" } }))
          .status,
      ).toBe(403);
    },
    TEST_MS,
  );

  it(
    "chặn chéo tenant: tenant_admin công ty khác ⇒ 404 cả đọc lẫn sửa, không có gì bị ghi",
    async () => {
      const hoa = await env.token("globex", "hoa");
      expect((await api.get(url(ACME), { token: hoa })).status).toBe(404);
      expect(
        (await api.patch(url(ACME), { token: hoa, body: { version: 1, legal_name: "Hack" } }))
          .status,
      ).toBe(404);
      const [row] = await guard(
        "owner SQL",
        env.owner`select legal_name from admin.tenants where id = ${ACME}`,
      );
      expect(row?.legal_name).toBeNull();
      // Chính công ty họ đọc được.
      expect((await api.get(url(GLOBEX), { token: hoa })).status).toBe(200);
    },
    TEST_MS,
  );

  it(
    "CEO/Giám đốc không phải thành viên công ty ⇒ 422 câu rõ ràng, DB cũng chặn FK chéo công ty",
    async () => {
      const admin = await env.token("platform", "admin");
      const v = TenantCompanyProfileSchema.parse(
        (await api.get(url(ACME), { token: admin })).json,
      ).version;
      // User công ty khác.
      const other = await api.patch(url(ACME), {
        token: admin,
        body: { version: v, ceo_user_id: USER_ID.hoa },
      });
      expect(other.status).toBe(422);
      expect(other.json.error.code).toBe("LEADER_NOT_MEMBER");
      expect(other.json.error.details).toEqual({ fields: ["ceo_user_id"] });
      // User đã ngừng hoạt động (Em).
      const inactive = await api.patch(url(ACME), {
        token: admin,
        body: { version: v, director_user_id: USER_ID.em },
      });
      expect(inactive.status).toBe(422);
      expect(inactive.json.error.details).toEqual({ fields: ["director_user_id"] });
      // Không có gì được ghi (version giữ nguyên).
      const [row] = await guard(
        "owner SQL",
        env.owner`select version, ceo_user_id from admin.tenants where id = ${ACME}`,
      );
      expect(row?.version).toBe(v);
      expect(row?.ceo_user_id).toBeNull();
      // Lớp DB: ghi thẳng user công ty khác vi phạm FK kép.
      // (postgres.js Query là thenable lười: `expect(query).rejects` treo trên bun 1.3.14 ⇒ bọc async rồi bắt lỗi tường minh.)
      let fkError: unknown = null;
      try {
        await guard(
          "owner: ghi CEO công ty khác",
          env.owner`update admin.tenants set ceo_user_id = ${USER_ID.hoa} where id = ${ACME}`.then(
            (r) => r,
          ),
        );
      } catch (e) {
        fkError = e;
      }
      expect((fkError as { code?: string } | null)?.code).toBe("23503"); // foreign_key_violation
    },
    TEST_MS,
  );

  it(
    "perf: GET hồ sơ ≤ 2 câu SQL dữ liệu (+1 câu đặt scope RLS)",
    async () => {
      setProbe(true);
      const db = createDb(ADMIN_API_URL, { max: 2 });
      try {
        await getTenantProfile({ db }, { kind: "platform" }, ACME); // làm nóng (type discovery)
        const before = sqlCounters().sql;
        await getTenantProfile({ db }, { kind: "platform" }, ACME);
        expect(sqlCounters().sql - before).toBeLessThanOrEqual(3);
      } finally {
        setProbe(false);
        await db.close();
      }
    },
    TEST_MS,
  );
});

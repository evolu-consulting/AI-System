// M1D-FR-02 · M1D-FR-03 · org.service gọi trực tiếp (role admin_api, scope tenant): gán/bỏ quản lý (closure), vòng ⇒
// VALIDATION_ERROR `manager_cycle`, quản lý/trưởng phòng ngoài tenant ⇒ NOT_FOUND, đánh dấu phòng ban + đọc cơ cấu một lần.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ErrorCode } from "@ai/contracts";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { getOrg, type OrgCall, setDepartment, setManager } from "./org.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000f1001";
const OTHER = "01900000-0000-7000-8000-0000000f1002";
const ADMIN = "01900000-0000-7000-8000-0000000f1011";
const U1 = "01900000-0000-7000-8000-0000000f1012";
const U2 = "01900000-0000-7000-8000-0000000f1013";
const U3 = "01900000-0000-7000-8000-0000000f1014";
const X = "01900000-0000-7000-8000-0000000f1021";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const call: OrgCall = {
  ctx: { db },
  actor: { userId: ADMIN, tenantId: TID, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: TID },
};
const user = (id: string, tid: string, name: string, role = "member") =>
  owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${id}, ${tid}, ${name}, 'x', ${name}, ${role}, ${`${name}@x.test`})`;
const fails = async (p: Promise<unknown>, code: ErrorCode) =>
  isAppError(await p.catch((e) => e), code);

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme'), (${OTHER}, 'beta', 'Beta')`;
  await user(ADMIN, TID, "binh", "tenant_admin");
  await user(U1, TID, "lan");
  await user(U2, TID, "thu");
  await user(U3, TID, "tam");
  await user(X, OTHER, "an");
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("M1D-FR-02 · quản lý trực tiếp", () => {
  test("gán chuỗi U3→U2→U1, đọc lại manager_id; closure 3 cặp; bỏ quản lý U2 ⇒ còn 1 cặp", async () => {
    await setManager(call, undefined, U2, { manager_id: U1 });
    await setManager(call, undefined, U3, { manager_id: U2 });
    const org = await getOrg(call, undefined);
    const mgr = Object.fromEntries(org.members.map((m) => [m.user_id, m.manager_id]));
    expect({ u2: mgr[U2], u3: mgr[U3], u1: mgr[U1] }).toEqual({ u2: U1, u3: U2, u1: null });
    const n = async () =>
      (
        await owner<
          { n: number }[]
        >`select count(*)::int as n from admin.user_reports where tenant_id = ${TID}`
      )[0]?.n;
    expect(await n()).toBe(3);
    await setManager(call, undefined, U2, { manager_id: null });
    expect(await n()).toBe(1);
  });
  test("vòng (U1 nhận U3 làm quản lý khi U3 dưới U1) và tự quản lý ⇒ VALIDATION_ERROR; không ghi gì", async () => {
    await setManager(call, undefined, U2, { manager_id: U1 });
    await setManager(call, undefined, U3, { manager_id: U2 });
    expect(
      await fails(setManager(call, undefined, U1, { manager_id: U3 }), "VALIDATION_ERROR"),
    ).toBe(true);
    expect(
      await fails(setManager(call, undefined, U1, { manager_id: U1 }), "VALIDATION_ERROR"),
    ).toBe(true);
    const [r] = await owner<
      { n: number }[]
    >`select count(*)::int as n from admin.user_managers where user_id = ${U1}`;
    expect(r?.n).toBe(0);
  });
  test("user hoặc quản lý của tenant khác ⇒ NOT_FOUND (tenant_admin không chạm tenant khác)", async () => {
    expect(await fails(setManager(call, undefined, X, { manager_id: U1 }), "NOT_FOUND")).toBe(true);
    expect(await fails(setManager(call, undefined, U1, { manager_id: X }), "NOT_FOUND")).toBe(true);
  });
});

describe("M1D-FR-03 · phòng ban = Group + trưởng phòng", () => {
  test("đánh dấu Group, đọc lại head + thành viên; bỏ đánh dấu; Group tenant khác ⇒ NOT_FOUND", async () => {
    const [g] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${TID}, 'kd', '{"vi":"Kinh doanh"}') returning id`;
    const gid = g?.id as string;
    await owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TID}, ${gid}, ${U2}), (${TID}, ${gid}, ${U3})`;
    await setDepartment(call, undefined, gid, { head_user_id: U1 });
    const org = await getOrg(call, undefined);
    expect(org.departments).toEqual([
      {
        group_id: gid,
        key: "kd",
        name: "Kinh doanh",
        head_user_id: U1,
        member_ids: [U2, U3].sort(),
      },
    ]);
    expect(await fails(setDepartment(call, undefined, gid, { head_user_id: X }), "NOT_FOUND")).toBe(
      true,
    );
    await setDepartment(call, undefined, gid, "remove");
    expect((await getOrg(call, undefined)).departments).toEqual([]);
    const [og] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${OTHER}, 'kd', '{"vi":"KD"}') returning id`;
    expect(
      await fails(
        setDepartment(call, undefined, og?.id as string, { head_user_id: null }),
        "NOT_FOUND",
      ),
    ).toBe(true);
  });
});

describe("M1c · audit đổi quản lý / trưởng phòng ghi giá trị cũ (review A-10)", () => {
  const lastSummary = async (id: string) =>
    (
      await owner<{ s: Record<string, unknown> }[]>`select summary as s from admin.audit_log
        where tenant_id = ${TID} and entity_id = ${id} order by seq desc limit 1`
    )[0]?.s;
  test("bỏ quản lý U2 (đang là U1) ⇒ summary.before.manager_id = U1; đổi trưởng phòng ⇒ before.head cũ", async () => {
    await setManager(call, undefined, U2, { manager_id: U1 });
    await setManager(call, undefined, U2, { manager_id: null });
    const [g] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${TID}, 'm1c', '{"vi":"M1c"}') returning id`;
    const gid = g?.id as string;
    await setDepartment(call, undefined, gid, { head_user_id: U1 });
    const first = await lastSummary(gid);
    await setDepartment(call, undefined, gid, { head_user_id: U3 });
    expect({
      mgr: await lastSummary(U2),
      first: first?.before,
      dept: (await lastSummary(gid))?.before,
    }).toEqual({
      mgr: { manager_id: null, before: { manager_id: U1 } },
      first: { department: null },
      dept: { department: { head_user_id: U1 } },
    });
  });
});

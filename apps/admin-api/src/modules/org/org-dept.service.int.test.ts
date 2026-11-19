// CR-189 · BR-189-6 · sửa cơ cấu trên sơ đồ gọi trực tiếp service (role admin_api, scope tenant): tạo phòng một lời gọi,
// đổi tên, chuyển/bỏ thành viên (mỗi người một phòng), chuyển phòng cha, xoá chỉ phòng rỗng; quyền theo nhóm; đồng thời.
// Dữ liệu dựng bằng owner SQL / do quản trị A tạo; thao tác do quản trị B (khác người tạo) — N2.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ErrorCode } from "@ai/contracts/common";
import { DeptCreateRequestSchema } from "@ai/contracts/org";
import { createDb, runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { type AppError, isAppError } from "../../lib/errors";
import { getOrg, type OrgCall, setDepartment } from "./org.service";
import { addDeptMembers, removeDeptMember } from "./org-dept.members";
import { createDept, deleteDept, renameDept } from "./org-dept.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000f2001";
const OTHER = "01900000-0000-7000-8000-0000000f2002";
const ADMIN = "01900000-0000-7000-8000-0000000f2011"; // người tạo dữ liệu
const ADMIN2 = "01900000-0000-7000-8000-0000000f2012"; // người được giao (khác người tạo)
const U1 = "01900000-0000-7000-8000-0000000f2021";
const U2 = "01900000-0000-7000-8000-0000000f2022";
const U3 = "01900000-0000-7000-8000-0000000f2023";
const U4 = "01900000-0000-7000-8000-0000000f2024";
const X = "01900000-0000-7000-8000-0000000f2031"; // công ty khác
const FEAT_F = "01900000-0000-7000-8000-0000000f2041";
const FEAT_G = "01900000-0000-7000-8000-0000000f2042";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const callOf = (userId: string, tid = TID): OrgCall => ({
  ctx: { db },
  actor: { userId, tenantId: tid, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: tid },
});
const creator = callOf(ADMIN);
const assignee = callOf(ADMIN2);
const user = (id: string, tid: string, name: string, role = "member") =>
  owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${id}, ${tid}, ${name}, 'x', ${name}, ${role}, ${`${name}@x.test`})`;
const fails = async (p: Promise<unknown>, code: string, details?: unknown) => {
  const e = await p.catch((x) => x);
  return (
    isAppError(e, code as ErrorCode) &&
    (details === undefined || Bun.deepEquals((e as AppError).details, details))
  );
};
const mk = async (name: string, parent: string | null = null, head: string | null = null) =>
  (await createDept(creator, undefined, { name, parent_group_id: parent, head_user_id: head }))
    .group_id;
const deptsOf = async (u: string) =>
  (
    await owner<{ group_id: string }[]>`select gm.group_id from admin.group_members gm
      join admin.departments d on d.group_id = gm.group_id where gm.user_id = ${u} order by 1`
  ).map((r) => r.group_id);
// biome-ignore lint/suspicious/noExplicitAny: hàng kết quả tuỳ câu
const count = async (q: PromiseLike<Record<string, any>[]>) => (await q)[0]?.n as number;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme'), (${OTHER}, 'beta', 'Beta')`;
  await user(ADMIN, TID, "binh", "tenant_admin");
  await user(ADMIN2, TID, "chi", "tenant_admin");
  for (const [id, n] of [
    [U1, "lan"],
    [U2, "thu"],
    [U3, "tam"],
    [U4, "hoa"],
  ] as const)
    await user(id, TID, n);
  await user(X, OTHER, "an");
  await owner`insert into admin.features (id, key, name) values (${FEAT_F}, 'f-one', '{"vi":"F"}'::jsonb), (${FEAT_G}, 'g-two', '{"vi":"G"}'::jsonb)`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("CR-189 · tạo phòng một lời gọi", () => {
  test("một lời gọi tạo Group + phòng ban + trưởng phòng, phòng con, key không dấu, không trùng", async () => {
    const a = await createDept(
      creator,
      undefined,
      DeptCreateRequestSchema.parse({ name: "  Kinh  doanh miền Bắc ", head_user_id: U1 }),
    );
    expect(a).toMatchObject({
      name: "Kinh doanh miền Bắc",
      key: "kinh-doanh-mien-bac",
      parent_group_id: null,
      head_user_id: U1,
    });
    const b = await createDept(assignee, undefined, { name: "Đội 1", parent_group_id: a.group_id });
    const b2 = await createDept(assignee, undefined, {
      name: "Đội 1",
      parent_group_id: b.group_id,
    });
    expect([b.key, b2.key]).toEqual(["doi-1", "doi-1-2"]);
    const org = await getOrg(creator, undefined);
    expect(org.departments.map((d) => [d.name, d.parent_group_id, d.head_user_id]).sort()).toEqual(
      [
        ["Kinh doanh miền Bắc", null, U1],
        ["Đội 1", a.group_id, null],
        ["Đội 1", b.group_id, null],
      ].sort(),
    );
    const [g] = await owner`select version, updated_by from admin.groups where id = ${a.group_id}`;
    expect(g).toMatchObject({ version: 1, updated_by: ADMIN });
  });
  test("tên trùng cùng cấp (không phân hoa/thường) ⇒ 409 NAME_TAKEN, khác cấp thì được", async () => {
    const a = await mk("Kinh doanh");
    const b = await mk("Kỹ thuật");
    expect(await fails(createDept(assignee, undefined, { name: "KINH DOANH" }), "NAME_TAKEN")).toBe(
      true,
    );
    await createDept(assignee, undefined, { name: "Kinh doanh", parent_group_id: b }); // cấp khác
    expect(
      await fails(
        createDept(assignee, undefined, { name: "kinh doanh", parent_group_id: b }),
        "NAME_TAKEN",
      ),
    ).toBe(true);
    expect(a).toBeTruthy();
  });
  test("cha không phải phòng ban / công ty khác ⇒ NOT_FOUND, trưởng phòng ngoài công ty ⇒ NOT_FOUND, đối tác ⇒ 422, không ghi gì (nguyên tử)", async () => {
    const [plain] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${TID}, 'plain', '{"vi":"Nhóm thường"}') returning id`;
    const [og] = await owner<
      { id: string }[]
    >`insert into admin.groups (tenant_id, key, name) values (${OTHER}, 'kd', '{"vi":"KD"}') returning id`;
    const orgId = (
      await owner<
        { id: string }[]
      >`insert into admin.external_orgs (tenant_id, name) values (${TID}, 'NCC') returning id`
    )[0]?.id;
    await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, external_org_id)
      values ('01900000-0000-7000-8000-0000000f2099', ${TID}, 'ncc', 'x', 'NCC', 'member', 'n@x.test', 'external', ${orgId as string})`;
    const before = await count(
      owner`select count(*)::int as n from admin.groups where tenant_id = ${TID}`,
    );
    expect(
      await fails(
        createDept(creator, undefined, { name: "A", parent_group_id: plain?.id }),
        "NOT_FOUND",
      ),
    ).toBe(true);
    expect(
      await fails(
        createDept(creator, undefined, { name: "A", parent_group_id: og?.id }),
        "NOT_FOUND",
      ),
    ).toBe(true);
    expect(
      await fails(createDept(creator, undefined, { name: "A", head_user_id: X }), "NOT_FOUND"),
    ).toBe(true);
    expect(
      await fails(
        createDept(creator, undefined, {
          name: "A",
          head_user_id: "01900000-0000-7000-8000-0000000f2099",
        }),
        "EXTERNAL_USER_NOT_ALLOWED",
      ),
    ).toBe(true);
    expect(
      await count(owner`select count(*)::int as n from admin.groups where tenant_id = ${TID}`),
    ).toBe(before);
    expect(
      await count(owner`select count(*)::int as n from admin.departments where tenant_id = ${TID}`),
    ).toBe(0);
  });
  test("ghi audit tạo phòng (người thực hiện = quản trị được giao)", async () => {
    const a = await createDept(assignee, undefined, { name: "Kế toán" });
    const [r] =
      await owner`select actor_id, action, entity from admin.audit_log where entity_id = ${a.group_id}`;
    expect(r).toMatchObject({ actor_id: ADMIN2, action: "create", entity: "group" });
  });
});

describe("CR-189 · đổi tên + chuyển phòng cha + đổi trưởng phòng", () => {
  test("đổi tên: trả tên cũ, giữ name.en, version +1, trùng cùng cấp ⇒ NAME_TAKEN, cùng tên ⇒ không đổi", async () => {
    const a = await mk("Kinh doanh");
    await mk("Kỹ thuật");
    await owner`update admin.groups set name = '{"vi":"Kinh doanh","en":"Sales"}' where id = ${a}`;
    expect(await renameDept(assignee, undefined, a, { name: "Bán hàng" })).toEqual({
      group_id: a,
      name: "Bán hàng",
      before: "Kinh doanh",
    });
    const [g] = await owner`select name, version from admin.groups where id = ${a}`;
    expect(g).toMatchObject({ name: { vi: "Bán hàng", en: "Sales" }, version: 2 });
    expect(
      await fails(renameDept(assignee, undefined, a, { name: "kỹ thuật" }), "NAME_TAKEN"),
    ).toBe(true);
    expect((await renameDept(assignee, undefined, a, { name: "Bán hàng" })).before).toBe(
      "Bán hàng",
    );
    expect((await owner`select version from admin.groups where id = ${a}`)[0]?.version).toBe(2);
    expect(
      await fails(
        renameDept(assignee, undefined, "01900000-0000-7000-8000-0000000f2fff", { name: "Z" }),
        "NOT_FOUND",
      ),
    ).toBe(true);
  });
  test("đổi trưởng phòng, chuyển phòng cha (trùng tên ở cha mới ⇒ NAME_TAKEN, vào con của chính nó ⇒ dept_cycle)", async () => {
    const a = await mk("Kinh doanh", null, U1);
    const b = await mk("Đội 1", a);
    const c = await mk("Đội 2", b);
    const d = await mk("Đội 1"); // gốc, trùng tên với b (khác cấp)
    await setDepartment(assignee, undefined, a, { head_user_id: U2 });
    expect(
      (await getOrg(creator, undefined)).departments.find((x) => x.group_id === a)?.head_user_id,
    ).toBe(U2);
    expect(
      await fails(
        setDepartment(assignee, undefined, b, { head_user_id: null, parent_group_id: null }),
        "NAME_TAKEN",
      ),
    ).toBe(true);
    await setDepartment(assignee, undefined, b, { head_user_id: null, parent_group_id: a }); // không đổi cha ⇒ không kiểm tên
    expect(
      await fails(
        setDepartment(assignee, undefined, a, { head_user_id: U2, parent_group_id: c }),
        "VALIDATION_ERROR",
        { reason: "dept_cycle" },
      ),
    ).toBe(true);
    await setDepartment(assignee, undefined, c, { head_user_id: null, parent_group_id: d });
    expect(
      (await getOrg(creator, undefined)).departments.find((x) => x.group_id === c)?.parent_group_id,
    ).toBe(d);
  });
});

describe("CR-189 · thành viên: mỗi người một phòng", () => {
  test("thêm người chưa có phòng, thêm lại ⇒ already, người phòng khác ⇒ CHUYỂN (rời hẳn phòng cũ)", async () => {
    const a = await mk("A");
    const b = await mk("B");
    const r1 = await addDeptMembers(assignee, undefined, a, { user_ids: [U1, U2] });
    expect(r1).toMatchObject({
      group_id: a,
      added: [U1, U2].sort(),
      already: [],
      moved: [],
      access: { gained: 0, lost: 0 },
    });
    const r2 = await addDeptMembers(assignee, undefined, a, { user_ids: [U1] });
    expect(r2).toMatchObject({ added: [], already: [U1] });
    const r3 = await addDeptMembers(assignee, undefined, b, { user_ids: [U1, U3] });
    expect(r3.added).toEqual([U1, U3].sort());
    expect(r3.moved).toEqual([{ user_id: U1, from_group_ids: [a] }]);
    expect([await deptsOf(U1), await deptsOf(U2), await deptsOf(U3)]).toEqual([[b], [a], [b]]);
  });
  test("người đang ở nhiều phòng (dữ liệu cũ) ⇒ khi thêm vào phòng khác rời mọi phòng ban cũ, Group không phải phòng ban giữ nguyên", async () => {
    const a = await mk("A");
    const b = await mk("B");
    const c = await mk("C");
    const [role] = await owner<
      { id: string }[]
    >`insert into admin.groups (tenant_id, key, name) values (${TID}, 'vai', '{"vi":"Vai"}') returning id`;
    await owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TID}, ${a}, ${U1}), (${TID}, ${b}, ${U1}), (${TID}, ${role?.id as string}, ${U1})`;
    const r = await addDeptMembers(assignee, undefined, c, { user_ids: [U1] });
    expect(r.moved[0]?.from_group_ids.sort()).toEqual([a, b].sort());
    expect(await deptsOf(U1)).toEqual([c]);
    expect(
      await count(
        owner`select count(*)::int as n from admin.group_members where group_id = ${role?.id as string}`,
      ),
    ).toBe(1);
  });
  test("trưởng phòng của phòng khác ⇒ 409 MEMBER_IS_HEAD, cả lô lùi (người khác trong lô không bị chuyển)", async () => {
    const a = await mk("A", null, U1);
    const b = await mk("B");
    await addDeptMembers(assignee, undefined, a, { user_ids: [U2] });
    const e = await addDeptMembers(assignee, undefined, b, { user_ids: [U2, U1] }).catch((x) => x);
    expect(isAppError(e, "MEMBER_IS_HEAD" as ErrorCode)).toBe(true);
    expect((e as AppError).status).toBe(409);
    expect((e as AppError).details).toEqual({ user_ids: [U1], group_ids: [a] });
    expect(await deptsOf(U2)).toEqual([a]);
    // đổi trưởng phòng trước thì chuyển được; trưởng phòng của CHÍNH phòng đích thêm vào là được
    await setDepartment(assignee, undefined, a, { head_user_id: null });
    expect((await addDeptMembers(assignee, undefined, b, { user_ids: [U1] })).added).toEqual([U1]);
    await setDepartment(assignee, undefined, b, { head_user_id: U1 });
    expect((await addDeptMembers(assignee, undefined, b, { user_ids: [U1] })).already).toEqual([
      U1,
    ]);
  });
  test("người công ty khác / không tồn tại ⇒ NOT_FOUND, đối tác ⇒ 422, phòng công ty khác ⇒ NOT_FOUND, không ghi", async () => {
    const a = await mk("A");
    const [og] = await owner<
      { id: string }[]
    >`insert into admin.groups (tenant_id, key, name) values (${OTHER}, 'kd', '{"vi":"KD"}') returning id`;
    await owner`insert into admin.departments (tenant_id, group_id) values (${OTHER}, ${og?.id as string})`;
    expect(
      await fails(addDeptMembers(assignee, undefined, a, { user_ids: [U1, X] }), "NOT_FOUND"),
    ).toBe(true);
    expect(
      await fails(
        addDeptMembers(assignee, undefined, og?.id as string, { user_ids: [U1] }),
        "NOT_FOUND",
      ),
    ).toBe(true);
    expect(await deptsOf(U1)).toEqual([]);
    const orgId = (
      await owner<
        { id: string }[]
      >`insert into admin.external_orgs (tenant_id, name) values (${TID}, 'NCC') returning id`
    )[0]?.id;
    await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, external_org_id)
      values ('01900000-0000-7000-8000-0000000f2099', ${TID}, 'ncc', 'x', 'NCC', 'member', 'n@x.test', 'external', ${orgId as string})`;
    expect(
      await fails(
        addDeptMembers(assignee, undefined, a, {
          user_ids: ["01900000-0000-7000-8000-0000000f2099"],
        }),
        "EXTERNAL_USER_NOT_ALLOWED",
      ),
    ).toBe(true);
  });
  test("bỏ khỏi phòng ⇒ về phòng cha, phòng cấp trên cùng ⇒ về công ty, không phải thành viên ⇒ không đổi", async () => {
    const a = await mk("A");
    const b = await mk("B", a);
    await addDeptMembers(assignee, undefined, b, { user_ids: [U1, U2] });
    expect(await removeDeptMember(assignee, undefined, b, U1)).toEqual({
      group_id: b,
      user_id: U1,
      removed: true,
      moved_to_group_id: a,
      access: { gained: 0, lost: 0 },
    });
    expect(await deptsOf(U1)).toEqual([a]);
    expect(await removeDeptMember(assignee, undefined, a, U1)).toMatchObject({
      removed: true,
      moved_to_group_id: null,
    });
    expect(await deptsOf(U1)).toEqual([]);
    expect(await removeDeptMember(assignee, undefined, a, U1)).toMatchObject({
      removed: false,
      moved_to_group_id: null,
    });
    expect(await fails(removeDeptMember(assignee, undefined, a, X), "NOT_FOUND")).toBe(true);
    expect(await deptsOf(U2)).toEqual([b]);
  });
  test("bỏ trưởng phòng của chính phòng ⇒ 409 MEMBER_IS_HEAD, người còn ở phòng ban khác ⇒ không kéo thêm về cha", async () => {
    const a = await mk("A");
    const b = await mk("B", a, U1);
    await owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TID}, ${b}, ${U1}), (${TID}, ${b}, ${U2}), (${TID}, ${a}, ${U2}), (${TID}, ${a}, ${U3})`;
    expect(
      await fails(removeDeptMember(assignee, undefined, b, U1), "MEMBER_IS_HEAD", {
        user_ids: [U1],
        group_ids: [b],
      }),
    ).toBe(true);
    expect(await removeDeptMember(assignee, undefined, b, U2)).toMatchObject({
      removed: true,
      moved_to_group_id: null,
    });
    expect(await deptsOf(U2)).toEqual([a]);
  });
});

describe("CR-189 · xoá phòng: chỉ phòng rỗng", () => {
  test("còn người (kể cả chỉ có trưởng phòng) hoặc còn phòng con ⇒ 409 DEPT_NOT_EMPTY kèm số, không xoá gì", async () => {
    const a = await mk("A");
    const b = await mk("B", a, U1);
    await addDeptMembers(assignee, undefined, b, { user_ids: [U2, U1] });
    expect(
      await fails(deleteDept(assignee, undefined, b), "DEPT_NOT_EMPTY", {
        members: 2,
        children: 0,
      }),
    ).toBe(true);
    expect(
      await fails(deleteDept(assignee, undefined, a), "DEPT_NOT_EMPTY", {
        members: 0,
        children: 1,
      }),
    ).toBe(true);
    const h = await mk("H", null, U3); // chỉ có trưởng phòng
    expect(
      await fails(deleteDept(assignee, undefined, h), "DEPT_NOT_EMPTY", {
        members: 1,
        children: 0,
      }),
    ).toBe(true);
    expect(
      await count(owner`select count(*)::int as n from admin.departments where tenant_id = ${TID}`),
    ).toBe(3);
    const e = await deleteDept(assignee, undefined, a).catch((x) => x);
    expect((e as AppError).status).toBe(409);
  });
  test("phòng rỗng ⇒ xoá cả Group, con rỗng xoá trước rồi cha xoá được, công ty khác ⇒ NOT_FOUND", async () => {
    const a = await mk("A");
    const b = await mk("B", a);
    expect(await deleteDept(assignee, undefined, b)).toEqual({ group_deleted: true });
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: true });
    expect(
      await count(owner`select count(*)::int as n from admin.groups where id in (${a}, ${b})`),
    ).toBe(0);
    const [og] = await owner<
      { id: string }[]
    >`insert into admin.groups (tenant_id, key, name) values (${OTHER}, 'kd', '{"vi":"KD"}') returning id`;
    await owner`insert into admin.departments (tenant_id, group_id) values (${OTHER}, ${og?.id as string})`;
    expect(await fails(deleteDept(assignee, undefined, og?.id as string), "NOT_FOUND")).toBe(true);
    expect(await fails(deleteDept(assignee, undefined, a), "NOT_FOUND")).toBe(true);
  });
  test("Group còn quyền theo nhóm (feature_grants) ⇒ chỉ bỏ đánh dấu phòng ban, Group + quyền giữ nguyên", async () => {
    const a = await mk("A");
    await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${TID}, ${FEAT_F}, ${a})`;
    expect(await deleteDept(assignee, undefined, a)).toEqual({ group_deleted: false });
    expect(await count(owner`select count(*)::int as n from admin.groups where id = ${a}`)).toBe(1);
    expect(
      await count(owner`select count(*)::int as n from admin.departments where group_id = ${a}`),
    ).toBe(0);
    expect(
      await count(owner`select count(*)::int as n from admin.feature_grants where group_id = ${a}`),
    ).toBe(1);
  });
});

describe("CR-189 · chuyển người giữa phòng có đổi quyền theo nhóm (feature_grants) — báo gained/lost", () => {
  test("rời phòng có quyền F, đến phòng có quyền G ⇒ lost 1, gained 1, quyền F còn từ nhóm khác ⇒ không mất, cấp trực tiếp không tính", async () => {
    const a = await mk("A");
    const b = await mk("B");
    const [extra] = await owner<
      { id: string }[]
    >`insert into admin.groups (tenant_id, key, name) values (${TID}, 'extra', '{"vi":"E"}') returning id`;
    await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${TID}, ${FEAT_F}, ${a}), (${TID}, ${FEAT_G}, ${b})`;
    await owner`insert into admin.feature_grants (tenant_id, feature_id, user_id) values (${TID}, ${FEAT_G}, ${U1})`;
    await addDeptMembers(assignee, undefined, a, { user_ids: [U1, U2] }); // vào A: được F (cả hai): gained 2
    const r = await addDeptMembers(assignee, undefined, b, { user_ids: [U1] });
    expect(r.access).toEqual({ gained: 1, lost: 1 }); // mất F từ A, được G từ B (G cấp trực tiếp không tính là "đã có" ⇒ vẫn gained theo nhóm)
    await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${TID}, ${FEAT_F}, ${extra?.id as string})`;
    await owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TID}, ${extra?.id as string}, ${U2})`;
    const r2 = await addDeptMembers(assignee, undefined, b, { user_ids: [U2] });
    expect(r2.access).toEqual({ gained: 1, lost: 0 }); // F còn từ nhóm `extra` ⇒ không mất; G mới được
    const r3 = await removeDeptMember(assignee, undefined, b, U2); // B không có cha ⇒ về công ty: mất G
    expect(r3.access).toEqual({ gained: 0, lost: 1 });
    // cấp trực tiếp của U1 không bị đụng
    expect(
      await count(owner`select count(*)::int as n from admin.feature_grants where user_id = ${U1}`),
    ).toBe(1);
  });
  test("phòng đến = phòng cha có quyền khi bỏ ⇒ báo được/mất đúng", async () => {
    const a = await mk("A");
    const b = await mk("B", a);
    await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${TID}, ${FEAT_F}, ${a}), (${TID}, ${FEAT_G}, ${b})`;
    await addDeptMembers(assignee, undefined, b, { user_ids: [U3] });
    expect((await removeDeptMember(assignee, undefined, b, U3)).access).toEqual({
      gained: 1,
      lost: 1,
    });
  });
});

describe("CR-189 · hai thao tác đồng thời không vỡ (khoá cố định theo công ty)", () => {
  test("cùng một người thêm vào hai phòng cùng lúc ⇒ không lỗi, cuối cùng đúng một phòng", async () => {
    const a = await mk("A");
    const b = await mk("B");
    for (let i = 0; i < 5; i++) {
      await Promise.all([
        addDeptMembers(assignee, undefined, a, { user_ids: [U1] }),
        addDeptMembers(creator, undefined, b, { user_ids: [U1] }),
      ]);
      expect((await deptsOf(U1)).length).toBe(1);
    }
  });
  test("hai lần tạo cùng tên cùng cấp ⇒ đúng một thành công, một NAME_TAKEN", async () => {
    const rs = await Promise.allSettled([
      createDept(assignee, undefined, { name: "Kế toán" }),
      createDept(creator, undefined, { name: "kế toán" }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(isAppError(bad.reason, "NAME_TAKEN")).toBe(true);
    expect(
      await count(owner`select count(*)::int as n from admin.departments where tenant_id = ${TID}`),
    ).toBe(1);
  });
  test("hai lần đổi cha chéo nhau (A→con B, B→con A) ⇒ không tạo vòng", async () => {
    const a = await mk("A");
    const b = await mk("B");
    const rs = await Promise.allSettled([
      setDepartment(assignee, undefined, a, { head_user_id: null, parent_group_id: b }),
      setDepartment(creator, undefined, b, { head_user_id: null, parent_group_id: a }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    const org = await getOrg(creator, undefined);
    expect(org.departments.filter((d) => d.parent_group_id !== null).length).toBe(1);
  });
  test("xoá phòng và thêm người vào chính phòng đó cùng lúc ⇒ hoặc xoá thành công (người không vào), hoặc bị chặn, không bao giờ phòng mất mà còn thành viên", async () => {
    for (let i = 0; i < 4; i++) {
      const a = await mk(`P${i}`);
      const rs = await Promise.allSettled([
        deleteDept(assignee, undefined, a),
        addDeptMembers(creator, undefined, a, { user_ids: [U4] }),
      ]);
      const left = await count(
        owner`select count(*)::int as n from admin.group_members where group_id = ${a}`,
      );
      const exists = await count(
        owner`select count(*)::int as n from admin.departments where group_id = ${a}`,
      );
      expect(exists === 0 ? left : 0).toBe(0);
      expect(rs.some((r) => r.status === "fulfilled")).toBe(true);
      await owner`delete from admin.group_members where user_id = ${U4}`;
    }
  });
});

describe("CR-189 · quản trị công ty khác không chạm được", () => {
  test("quản trị công ty khác (kể cả khi biết id) ⇒ NOT_FOUND ở mọi thao tác, không ghi", async () => {
    const a = await mk("A");
    const stranger = callOf("01900000-0000-7000-8000-0000000f2fa0", OTHER);
    expect(await fails(renameDept(stranger, undefined, a, { name: "Z" }), "NOT_FOUND")).toBe(true);
    expect(
      await fails(addDeptMembers(stranger, undefined, a, { user_ids: [X] }), "NOT_FOUND"),
    ).toBe(true);
    expect(await fails(removeDeptMember(stranger, undefined, a, X), "NOT_FOUND")).toBe(true);
    expect(await fails(deleteDept(stranger, undefined, a), "NOT_FOUND")).toBe(true);
    expect(
      await fails(createDept(stranger, undefined, { name: "Z", parent_group_id: a }), "NOT_FOUND"),
    ).toBe(true);
    expect((await getOrg(creator, undefined)).departments.map((d) => d.name)).toEqual(["A"]);
  });
});

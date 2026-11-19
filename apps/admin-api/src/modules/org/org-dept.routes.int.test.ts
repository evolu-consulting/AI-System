// CR-189 · BR-189-6 · `/admin/org/departments*` qua HTTP thật (app + DB): CHỈ quản trị (platform_admin cần ?tenant_id,
// tenant_admin công ty mình); member ⇒ 403 trước khi tra thực thể/đọc body; không đăng nhập ⇒ 401; công ty khác ⇒ 404;
// lỗi nghiệp vụ có mã + `details` đúng; thao tác do quản trị KHÁC người tạo (N2).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  DeptCreateResponseSchema,
  DeptMemberRemoveResponseSchema,
  DeptMembersAddResponseSchema,
  DeptRenameResponseSchema,
} from "@ai/contracts/org";
import {
  createEnv,
  type Env,
  TENANT_ID,
  USER_ID,
} from "../../../../../tests/acceptance/M1/_fixtures";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const code = (r: { json?: { error?: { code?: string } } }) => r.json?.error?.code;
const BASE = "/admin/org/departments";
const mk = async (token: string, name: string, parent?: string) => {
  const r = await env.call("POST", BASE, {
    token,
    body: { name, parent_group_id: parent ?? null },
  });
  expect(r.status).toBe(201);
  return DeptCreateResponseSchema.parse(r.json).group_id;
};

describe("CR-189 · chỉ quản trị", () => {
  it("member (an) ⇒ 403 ở mọi thao tác sửa cơ cấu, kể cả khi id không tồn tại, không đăng nhập ⇒ 401, không ghi gì", async () => {
    const admin = await env.token("acme", "binh");
    const g = await mk(admin, "Kinh doanh");
    const an = await env.token("acme", "an");
    const none = "01900000-0000-7000-8000-000000000999";
    const calls: [string, string, unknown][] = [
      ["POST", BASE, { name: "Z" }],
      ["PUT", `${BASE}/${g}/name`, { name: "Z" }],
      ["POST", `${BASE}/${g}/members`, { user_ids: [USER_ID.lan] }],
      ["DELETE", `${BASE}/${g}/members/${USER_ID.lan}`, undefined],
      ["DELETE", `${BASE}/${none}`, undefined],
      ["PUT", `${BASE}/${g}`, { head_user_id: null }],
    ];
    for (const [m, p, body] of calls) {
      expect((await env.call(m, p, { token: an, body })).status).toBe(403);
      expect((await env.call(m, p, { body })).status).toBe(401);
    }
    const rows =
      await env.owner`select count(*)::int as n from admin.departments where tenant_id = ${TENANT_ID.acme}`;
    expect(rows[0]?.n).toBe(1);
  });
  it("platform_admin phải nêu ?tenant_id khi ghi (thiếu ⇒ 400 TENANT_REQUIRED), có ⇒ ghi đúng công ty", async () => {
    const pa = await env.token("platform", "admin");
    expect(code(await env.call("POST", BASE, { token: pa, body: { name: "Z" } }))).toBe(
      "TENANT_REQUIRED",
    );
    const r = await env.call("POST", `${BASE}?tenant_id=${TENANT_ID.acme}`, {
      token: pa,
      body: { name: "Z" },
    });
    expect(r.status).toBe(201);
    expect(DeptCreateResponseSchema.parse(r.json).name).toBe("Z");
  });
});

describe("CR-189 · hành trình do quản trị được giao (khác người tạo)", () => {
  it("binh tạo phòng, chi (quản trị khác) đổi tên, chuyển người, bỏ người, bị chặn xoá khi còn người, rồi xoá khi rỗng", async () => {
    const binh = await env.token("acme", "binh");
    const chi = await env.token("acme", "chi");
    const a = await mk(binh, "Kinh doanh");
    const b = await mk(binh, "Miền Bắc", a);

    const ren = await env.call("PUT", `${BASE}/${b}/name`, {
      token: chi,
      body: { name: "  Hà Nội " },
    });
    expect(ren.status).toBe(200);
    expect(DeptRenameResponseSchema.parse(ren.json)).toEqual({
      group_id: b,
      name: "Hà Nội",
      before: "Miền Bắc",
    });
    expect(
      code(await env.call("PUT", `${BASE}/${b}/name`, { token: chi, body: { name: "" } })),
    ).toBe("VALIDATION_ERROR");

    const add = await env.call("POST", `${BASE}/${a}/members`, {
      token: chi,
      body: { user_ids: [USER_ID.lan, USER_ID.thu] },
    });
    expect(add.status).toBe(200);
    expect(DeptMembersAddResponseSchema.parse(add.json).added.sort()).toEqual(
      [USER_ID.lan, USER_ID.thu].sort(),
    );
    const mv = await env.call("POST", `${BASE}/${b}/members`, {
      token: chi,
      body: { user_ids: [USER_ID.lan] },
    });
    expect(DeptMembersAddResponseSchema.parse(mv.json).moved).toEqual([
      { user_id: USER_ID.lan, from_group_ids: [a] },
    ]);

    const blocked = await env.call("DELETE", `${BASE}/${b}`, { token: chi });
    expect(blocked.status).toBe(409);
    expect(blocked.json?.error).toMatchObject({
      code: "DEPT_NOT_EMPTY",
      details: { members: 1, children: 0 },
    });
    const blockedParent = await env.call("DELETE", `${BASE}/${a}`, { token: chi });
    expect(blockedParent.json?.error?.details).toEqual({ members: 1, children: 1 });

    const rm = await env.call("DELETE", `${BASE}/${b}/members/${USER_ID.lan}`, { token: chi });
    expect(rm.status).toBe(200);
    expect(DeptMemberRemoveResponseSchema.parse(rm.json)).toMatchObject({
      removed: true,
      moved_to_group_id: a,
    });
    expect((await env.call("DELETE", `${BASE}/${b}`, { token: chi })).status).toBe(204);
    expect((await env.call("DELETE", `${BASE}/${b}`, { token: chi })).status).toBe(404);
  });
  it("trưởng phòng phòng khác ⇒ 409 MEMBER_IS_HEAD kèm id, tên trùng cùng cấp ⇒ 409 NAME_TAKEN, thêm quá 50 người ⇒ 400", async () => {
    const binh = await env.token("acme", "binh");
    const a = await mk(binh, "A");
    const b = await mk(binh, "B");
    await env.call("PUT", `${BASE}/${a}`, { token: binh, body: { head_user_id: USER_ID.lan } });
    const r = await env.call("POST", `${BASE}/${b}/members`, {
      token: binh,
      body: { user_ids: [USER_ID.lan] },
    });
    expect(r.status).toBe(409);
    expect(r.json?.error).toMatchObject({
      code: "MEMBER_IS_HEAD",
      details: { user_ids: [USER_ID.lan], group_ids: [a] },
    });
    const dup = await env.call("POST", BASE, { token: binh, body: { name: "a" } });
    expect([dup.status, code(dup)]).toEqual([409, "NAME_TAKEN"]);
    const many = Array.from(
      { length: 51 },
      (_, i) => `01900000-0000-7000-8000-${String(5000 + i).padStart(12, "0")}`,
    );
    expect(
      (await env.call("POST", `${BASE}/${b}/members`, { token: binh, body: { user_ids: many } }))
        .status,
    ).toBe(400);
  });
  it("DB chỉ có Hub giả (môi trường chỉ-admin): xoá phòng rỗng ⇒ 204 (không 500), phòng còn agent theo nhóm ⇒ 204 nhưng Group giữ", async () => {
    const binh = await env.token("acme", "binh");
    const empty = await mk(binh, "Trống");
    const kept = await mk(binh, "Có agent");
    await env.owner`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (gen_random_uuid(), ${TENANT_ID.acme}, 'group', ${kept})`;
    expect((await env.call("DELETE", `${BASE}/${empty}`, { token: binh })).status).toBe(204);
    expect((await env.call("DELETE", `${BASE}/${kept}`, { token: binh })).status).toBe(204);
    const g =
      await env.owner`select (select count(*)::int from admin.groups where id = ${empty}) as e,
      (select count(*)::int from admin.groups where id = ${kept}) as k`;
    expect([g[0]?.e, g[0]?.k]).toEqual([0, 1]);
  });
  it("quản trị công ty khác (hoa, globex) ⇒ 404 ở mọi thao tác trên phòng của acme, không ghi", async () => {
    const binh = await env.token("acme", "binh");
    const hoa = await env.token("globex", "hoa");
    const a = await mk(binh, "A");
    for (const [m, p, body] of [
      ["PUT", `${BASE}/${a}/name`, { name: "Z" }],
      ["POST", `${BASE}/${a}/members`, { user_ids: [USER_ID.khang] }],
      ["DELETE", `${BASE}/${a}/members/${USER_ID.khang}`, undefined],
      ["DELETE", `${BASE}/${a}`, undefined],
    ] as [string, string, unknown][])
      expect((await env.call(m, p, { token: hoa, body })).status).toBe(404);
    expect(
      (await env.call("POST", BASE, { token: hoa, body: { name: "Z", parent_group_id: a } }))
        .status,
    ).toBe(404);
    const rows =
      await env.owner`select count(*)::int as n from admin.departments where tenant_id = ${TENANT_ID.acme}`;
    expect(rows[0]?.n).toBe(1);
  });
});

// CR-182 · lát cr182-roles · int (DB thật, role `hub_api`): hub 0159 `process_role_assignments` + `hub.role_assign` + `applyRoles`.
// RLS: công ty khác KHÔNG đọc giao việc · hàm ghi đòi cờ `app.company_admin` (người thường 42501) · BR-G3 audit trước/sau ·
// BR-G2 đổi giao việc ⇒ lượt MỚI dùng người mới, ảnh chụp đã lấy giữ người cũ · vai chưa giao ⇒ `unassigned` chặn (lượt mở từ sự kiện bị từ chối).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { assignRoleAudited } from "./role-assign.service";
import { applyRoles, loadRoleAssignments } from "./roles.repo";

const T = { a: tenantId(1820), b: tenantId(1821) };
const U = { adm: userId(1820), a2: userId(1821), a3: userId(1822), b1: userId(1823) };
const ROLE = { key: "nguoi-duyet-cap-1", label: "Người duyệt cấp 1" };
const STAGES = [
  { name: "Duyệt", after: { kind: "review", group_id: null, role: ROLE } },
  {
    name: "Ký",
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: { signer_role: { from: "const", value: "nguoi-ky" } },
    },
  },
];
let o: Sql;
let db: Db;
let flowId = "";
let gA = "";
let gB = "";
const g = (t: string, k: keyof typeof U) => ({ kind: "user", tenantId: t, userId: U[k] }) as const;
const who = (k: keyof typeof U) => ({ tenantId: T.a, userId: U[k], role: "member" });
const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    return x.code ?? x.cause?.code ?? "err";
  }
};
const snapshot = (tid: string) =>
  withHubScope(db, { kind: "user", tenantId: tid, userId: U.adm }, (tx) =>
    applyRoles(tx, tid, flowId, STAGES),
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 'p1820', 'P1820'), (${T.b}, 'p1821', 'P1821') on conflict do nothing`;
  await users(o, T.a, 3, { from: 1820 });
  await users(o, T.b, 1, { from: 1823 });
  const ga = await groups(o, T.a, ["ga", "gb"]);
  gA = ga.get("ga") as string;
  gB = ga.get("gb") as string;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
    values (${T.a}, 'cr182-roles', 'R', ${JSON.stringify(STAGES)}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts')
    returning id::text as id`;
  flowId = r?.id as string;
  db = createDb(urls().hubApi, { max: 4 });
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-182 roles · quyền ghi (BR-G1) + audit (BR-G3)", () => {
  it("người thường gọi thẳng hub.role_assign (không cờ quản trị công ty) ⇒ 42501, không ghi gì", async () => {
    expect(
      await code(() =>
        inHub(
          g(T.a, "a2"),
          (tx) =>
            tx`select * from hub.role_assign(${flowId}::uuid, ${ROLE.key}::text, ${gA}::uuid, null)`,
        ),
      ),
    ).toBe("42501");
    const [n] =
      await o`select count(*)::int as n from hub.process_role_assignments where tenant_id = ${T.a}`;
    expect(n?.n).toBe(0);
  });

  it("quản trị giao NHÓM ⇒ ghi + audit role_assigned trước rỗng và sau nhóm, cả hai đích hay nhóm công ty khác ⇒ 22023", async () => {
    const r = await assignRoleAudited(db, who("adm"), {
      flowId,
      roleKey: ROLE.key,
      groupId: gA,
      userId: null,
    });
    expect(r.before).toEqual({ group_id: null, user_id: null });
    expect(r.after).toEqual({ group_id: gA, user_id: null });
    const [a] = await o<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>`
      select before, after from hub.audit_log where tenant_id = ${T.a} and action = 'role_assigned' and entity_id = ${flowId}::uuid`;
    expect(a?.before).toMatchObject({ role_key: ROLE.key, group_id: null });
    expect(a?.after).toMatchObject({ role_key: ROLE.key, group_id: gA });
    const bad = (groupId: string | null, userId: string | null) =>
      assignRoleAudited(db, who("adm"), { flowId, roleKey: ROLE.key, groupId, userId }).catch(
        (e: { code?: string }) => e.code,
      );
    expect(await bad(gA, U.a2)).toBe("ROLE_ASSIGN_INVALID");
    const gOther = (await groups(o, T.b, ["gx"])).get("gx") as string;
    expect(await bad(gOther, null)).toBe("ROLE_ASSIGN_INVALID");
  });
});

describe("CR-182 roles · RLS + giải vai (R2) + BR-G2", () => {
  it("công ty khác KHÔNG đọc giao việc của công ty A", async () => {
    const mine = await withHubScope(db, g(T.a, "adm"), (tx) =>
      loadRoleAssignments(tx, T.a, [flowId]),
    );
    expect(mine.get(flowId)?.map((x) => x.role_key)).toEqual([ROLE.key]);
    const other = await withHubScope(db, g(T.b, "b1"), (tx) =>
      loadRoleAssignments(tx, T.a, [flowId]),
    );
    expect(other.size).toBe(0);
  });

  it("giao nhóm ⇒ lượt mới có group_id của nhóm, vai Ký chưa giao ⇒ unassigned chặn", async () => {
    const s = await snapshot(T.a);
    expect((s.stages[0] as { after: { group_id: string } }).after.group_id).toBe(gA);
    expect(s.unassigned.map((x) => [x.slot, x.role_key, x.blocking])).toEqual([
      ["sign", "nguoi-ky", true],
    ]);
  });

  it("BR-G2: đổi giao việc ⇒ ảnh chụp đã lấy giữ người cũ, lượt MỚI dùng người mới, bỏ giao ⇒ vai trống + chặn", async () => {
    const old = await snapshot(T.a);
    await assignRoleAudited(db, who("adm"), {
      flowId,
      roleKey: ROLE.key,
      groupId: null,
      userId: U.a3,
    });
    const next = await snapshot(T.a);
    const afterOf = (x: { stages: unknown[] }) =>
      (x.stages[0] as { after: { group_id: string | null; approver_user_id?: string } }).after;
    expect(afterOf(old).group_id).toBe(gA);
    expect(afterOf(next)).toMatchObject({ group_id: null, approver_user_id: U.a3 });
    await assignRoleAudited(db, who("adm"), {
      flowId,
      roleKey: ROLE.key,
      groupId: null,
      userId: null,
    });
    const none = await snapshot(T.a);
    expect(none.unassigned.map((x) => x.role_key).sort()).toEqual([ROLE.key, "nguoi-ky"].sort());
    const [n] =
      await o`select count(*)::int as n from hub.audit_log where tenant_id = ${T.a} and action = 'role_assigned'`;
    expect(n?.n).toBe(3);
    // đổi sang nhóm khác cũng ghi được (không rác hàng cũ)
    await assignRoleAudited(db, who("adm"), {
      flowId,
      roleKey: ROLE.key,
      groupId: gB,
      userId: null,
    });
    const [c] =
      await o`select count(*)::int as n from hub.process_role_assignments where tenant_id = ${T.a} and flow_id = ${flowId}::uuid`;
    expect(c?.n).toBe(1);
  });
});

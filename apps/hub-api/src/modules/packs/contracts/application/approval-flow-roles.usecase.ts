// CR-182 · giao việc theo vai ở Sổ Hợp Tác: «giao cho ai» của từng vai (GET `graph[]`) + `PUT /approval-flow/roles` (quản trị công ty).
import type { RoleAssignment } from "@ai/contracts/flow";
import {
  APPROVAL_FLOW_MEMBERS_MAX,
  type ApprovalFlowAssigned,
  type ApprovalFlowRoleAssigned,
} from "@ai/contracts/pack-contracts";
import {
  checkPackAccess,
  type EventFlow,
  type PackAccessView,
  type PackWho,
  packAccessInput,
} from "../../kit/public";
import type { ApprovalEngineBridge } from "./approval-engine.ports";
import type { FlowGroups } from "./approval-flow.ports";

const NAME_MAX = 200;
export type RoleLookups = {
  names: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
  /** Thành viên của các Group được giao cho vai (id Group ⇒ người). */
  members: ReadonlyMap<string, { id: string; name: string }[]>;
};

/** CR-182 · người / Group được giao cho vai của các flow (để tra tên + thành viên một lần cho cả lô). */
export function assignedIdsOf(flows: readonly EventFlow[]) {
  const all = flows.flatMap((f) => f.assignments ?? []);
  return {
    users: all.flatMap((a) => (a.user_id ? [a.user_id] : [])),
    groups: [...new Set(all.flatMap((a) => (a.group_id ? [a.group_id] : [])))],
  };
}
export const membersOf = (
  g: Pick<FlowGroups, "members">,
  tenantId: string,
  ids: readonly string[],
) =>
  ids.length > 0 && g.members
    ? g.members(tenantId, ids, APPROVAL_FLOW_MEMBERS_MAX)
    : Promise.resolve(new Map<string, { id: string; name: string }[]>());

/** CR-182 · «giao cho ai» của một vai: nhóm (kèm thành viên) hoặc một người; chưa giao ⇒ null. */
export function assignedOf(
  a: RoleAssignment | undefined,
  lk: RoleLookups,
): ApprovalFlowAssigned | null {
  if (a?.group_id)
    return {
      kind: "group",
      id: a.group_id,
      name: lk.names.get(a.group_id)?.slice(0, NAME_MAX) ?? null,
      members: (lk.members.get(a.group_id) ?? []).slice(0, APPROVAL_FLOW_MEMBERS_MAX),
    };
  if (!a?.user_id) return null;
  const name = lk.users.get(a.user_id)?.slice(0, NAME_MAX) ?? null;
  return { kind: "user", id: a.user_id, name, members: [{ id: a.user_id, name: name ?? "" }] };
}

/** CR-182 · BR-G1/G3 · `PUT /approval-flow/roles`: giao / đổi / bỏ giao một vai. Route ĐÃ kiểm quyền quản trị công ty (Q15). Trả người được giao sau khi đổi. */
export function assignFlowRole(d: {
  engine?: ApprovalEngineBridge | undefined;
  groups: Pick<FlowGroups, "list" | "members">;
  userNames?: (who: PackWho, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}) {
  return async (
    who: PackWho & { role: string; isAdmin: boolean },
    i: { flow_id: string; role_key: string; group_id?: string | null; user_id?: string | null },
  ): Promise<ApprovalFlowRoleAssigned> => {
    const port = d.engine?.port;
    if (!port?.assignRole) throw new Error("role-assign: engine không nối");
    const r = await port.assignRole(who, {
      flowId: i.flow_id,
      roleKey: i.role_key,
      groupId: i.group_id ?? null,
      userId: i.user_id ?? null,
    });
    const a = r.after;
    const gid = a.group_id;
    const uid = a.user_id;
    const [list, members, users] = await Promise.all([
      gid && d.groups.list ? d.groups.list(who.tenantId) : [],
      gid && d.groups.members
        ? d.groups.members(who.tenantId, [gid], APPROVAL_FLOW_MEMBERS_MAX)
        : new Map<string, { id: string; name: string }[]>(),
      uid && d.userNames ? d.userNames(who, [uid]) : new Map<string, string>(),
    ]);
    const lk = {
      names: new Map(list.map((g) => [g.id, g.name])),
      members,
      users,
    };
    return {
      flow_id: i.flow_id,
      role_key: i.role_key,
      assigned: assignedOf({ role_key: i.role_key, group_id: gid, user_id: uid }, lk),
    };
  };
}

/** «Quản trị công ty» (Q15, BR-G1) = tenant_admin ∨ quyền `admin` gói Sổ Hợp Tác; quản trị nền tảng không phải. Cùng luật `signatures/company-admin`. */
export const companyAdminCheck =
  (view: PackAccessView) =>
  async (user: { role: string; userId: string; tenantId: string }): Promise<boolean> => {
    if (user.role === "tenant_admin") return true;
    if (user.role === "platform_admin") return false;
    const i = await packAccessInput(view, "contracts", user);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  };

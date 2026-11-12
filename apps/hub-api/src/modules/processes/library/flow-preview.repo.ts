// CR-127 · E7 · BR-17 · đọc dữ liệu thật của công ty cho "Chạy thử" (CHỈ ĐỌC — tx `read only`): quy trình (đã lưu / thư viện đã xuất bản),
// người dùng, phòng + thành viên + trưởng phòng, quản trị công ty, uỷ quyền đang sống. Số câu SQL cố định, không phụ thuộc số bước/người.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PreviewGroup, PreviewUser, World } from "../domain/preview/flow-preview.rules";
import type { DelegationKind } from "../domain/tasks/delegation.rules";

export type FlowRow = { event: string | null; stages: unknown[]; tenant_id: string | null };

/** Quy trình theo id: của chính công ty (bản đang soạn) hoặc Thư viện ĐÃ XUẤT BẢN (bản xuất bản). Không có ⇒ null. */
export async function flowRowOf(tx: Tx, tid: string, flowId: string): Promise<FlowRow | null> {
  const [r] =
    await tx.execute<FlowRow>(sql`select d.trigger_event as event, d.tenant_id::text as tenant_id,
      coalesce(r.stages, d.stages) as stages
    from hub.process_defs d
    left join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version and d.tenant_id is null
    where d.id = ${flowId}::uuid and d.deleted_at is null
      and ((d.tenant_id is null and d.published_version is not null) or d.tenant_id = ${tid}::uuid)`);
  return r ?? null;
}

const uuidArr = (ids: readonly string[]): string => `{${[...new Set(ids)].join(",")}}`;

/** Mã → id nhóm của công ty (quy trình Thư viện lưu nhóm theo MÃ; khớp đúng mã như lúc mở lượt thật). */
export async function groupIdsByKeyOf(
  tx: Tx,
  tid: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await tx.execute<{
    id: string;
    key: string;
  }>(sql`select id::text, key from admin.groups
    where tenant_id = ${tid}::uuid and key = any(${`{${keys.map((k) => `"${k}"`).join(",")}}`}::text[])`);
  return new Map(rows.map((x) => [x.key, x.id]));
}

type Need = { groupIds: readonly string[]; userIds: readonly string[]; at: Date };

/** Một lượt đọc: nhóm (tên/thành viên/trưởng phòng), người dùng (người gửi, người duyệt, người đóng vai… + quản trị), uỷ quyền. */
export async function loadWorld(tx: Tx, tid: string, n: Need): Promise<World> {
  const gids = uuidArr(n.groupIds);
  const groups = await tx.execute<{
    id: string;
    name: string | null;
    head: string | null;
    members: string[] | null;
  }>(sql`select g.id::text, g.name->>'vi' as name, d.head_user_id::text as head,
      array(select gm.user_id::text from admin.group_members gm where gm.tenant_id = g.tenant_id and gm.group_id = g.id
        order by gm.user_id) as members
    from admin.groups g left join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
    where g.tenant_id = ${tid}::uuid and g.id = any(${gids}::uuid[])`);
  const groupMap = new Map<string, PreviewGroup>(
    groups.map((g) => [
      g.id,
      { name: g.name ?? g.id, memberIds: g.members ?? [], headUserId: g.head },
    ]),
  );
  const want = [
    ...n.userIds,
    ...groups.flatMap((g) => [...(g.members ?? []), ...(g.head ? [g.head] : [])]),
  ];
  const users = await tx.execute<{ id: string; name: string; usable: boolean; role: string }>(sql`
    select u.id::text, u.display_name as name, (u.active and not u.locked_by_tenant) as usable, u.role
    from admin.users u where u.tenant_id = ${tid}::uuid
      and (u.id = any(${uuidArr(want)}::uuid[]) or (u.role = 'tenant_admin' and u.active and not u.locked_by_tenant))`);
  const dl = await tx.execute<{
    id: string;
    from_user_id: string;
    to_user_id: string;
    from_at: Date;
    to_at: Date;
    kinds: string[];
  }>(sql`select id::text, from_user_id::text, to_user_id::text, from_at, to_at, kinds
    from hub.delegations where tenant_id = ${tid}::uuid and revoked_at is null
      and from_at <= ${n.at.toISOString()}::timestamptz and to_at > ${n.at.toISOString()}::timestamptz
    order by from_at desc limit 500`);
  const [head] = await tx.execute<{
    any_head: boolean;
  }>(sql`select exists(select 1 from admin.departments
    where tenant_id = ${tid}::uuid and head_user_id is not null) as any_head`);
  return {
    tenantId: tid,
    anyDeptHead: head?.any_head ?? false,
    users: new Map<string, PreviewUser>(
      users.map((u) => [u.id, { id: u.id, name: u.name, usable: u.usable, role: u.role }]),
    ),
    groups: groupMap,
    adminIds: users
      .filter((u) => u.role === "tenant_admin")
      .map((u) => u.id)
      .sort(),
    delegations: dl.map((d) => ({
      id: d.id,
      fromUserId: d.from_user_id,
      toUserId: d.to_user_id,
      fromAt: new Date(d.from_at),
      toAt: new Date(d.to_at),
      kinds: d.kinds as DelegationKind[],
    })),
  };
}

export type FlowRowNamed = FlowRow & { id: string; name: string };

/** CR-127 · M4 · nhiều quy trình MỘT câu (`= any`): cùng luật chọn bản như `flowRowOf` (Thư viện ⇒ bản đã xuất bản; của công ty ⇒ bản đang dùng). */
export async function flowRowsOf(
  tx: Tx,
  tid: string,
  flowIds: readonly string[],
): Promise<Map<string, FlowRowNamed>> {
  if (flowIds.length === 0) return new Map();
  const rows =
    await tx.execute<FlowRowNamed>(sql`select d.id::text as id, coalesce(r.name, d.name) as name,
      d.trigger_event as event, d.tenant_id::text as tenant_id, coalesce(r.stages, d.stages) as stages
    from hub.process_defs d
    left join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version and d.tenant_id is null
    where d.id = any(${uuidArr(flowIds)}::uuid[]) and d.deleted_at is null
      and ((d.tenant_id is null and d.published_version is not null) or d.tenant_id = ${tid}::uuid)`);
  return new Map(rows.map((x) => [x.id, x]));
}

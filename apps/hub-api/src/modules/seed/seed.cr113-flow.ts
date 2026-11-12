// pm-ready · fixture CR-112/CR-113 cho tenant `evolu` (mở rộng `seed.tenant-fixtures`, KHÔNG phải seed song song): Group Pháp chế +
// 2 thành viên (người duyệt mẫu để công ty tự dựng quy trình Duyệt hợp đồng). CR-127 Z3d: KHÔNG còn ghi def/gán trên khe
// `contracts.approval` — quy trình duyệt do admin nền tảng soạn + gán cho công ty trên app (sơ đồ trống), không seed sẵn.
// Idempotent (on conflict), số câu SQL cố định. Gọi từ `writeTenantFixtures` (cổng libSampleEnabled đã chặn production).
import type { Tx } from "./seed.repo";

export const CR113_TENANT = "evolu";
export const LEGAL_GROUP = {
  key: "pb-phap-che",
  name: { vi: "Phòng Pháp chế", en: "Legal" },
  members: ["edgar.nguyen", "rowan.nguyen"],
} as const;

export type Cr113FlowResult = { legalGroups: number; legalMembers: number };

export async function writeCr113Flow(tx: Tx): Promise<Cr113FlowResult> {
  const r: Cr113FlowResult = { legalGroups: 0, legalMembers: 0 };
  const [t] = await tx`select id from admin.tenants where key = ${CR113_TENANT}`;
  if (!t) return r;
  r.legalGroups = (
    await tx`insert into admin.groups (tenant_id, key, name, description)
      values (${t.id}, ${LEGAL_GROUP.key}, ${tx.json(LEGAL_GROUP.name)}, 'Phòng Pháp chế (mẫu dev/test, CR-113)')
      on conflict (tenant_id, key) do nothing returning id`
  ).length;
  r.legalMembers = (
    await tx`insert into admin.group_members (tenant_id, group_id, user_id)
      select g.tenant_id, g.id, u.id from admin.groups g
      join admin.users u on u.tenant_id = g.tenant_id and u.username = any(${[...LEGAL_GROUP.members]}::text[])
      where g.tenant_id = ${t.id} and g.key = ${LEGAL_GROUP.key}
      on conflict do nothing returning user_id`
  ).length;
  await bumpIfChanged(tx, r, t.id as string);
  return r;
}

/** Group mới ghi bằng SQL ⇒ báo cache cấu hình (admin + hub) như `addRole` của test; chạy lại không đổi gì ⇒ không báo. */
async function bumpIfChanged(tx: Tx, r: Cr113FlowResult, tenantId: string): Promise<void> {
  if (Object.values(r).every((n) => n === 0)) return;
  const [m] =
    await tx`update admin.config_meta set config_version = config_version + 1 returning config_version as v`;
  await tx`select pg_notify('config_changed',
    json_build_object('v', ${m?.v ?? 1}::int, 'entity', 'group', 'tenant_id', ${tenantId}::text)::text)`;
  await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

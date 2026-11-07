// pm-ready · fixture CR-112/CR-113 cho tenant `evolu` (mở rộng `seed.tenant-fixtures`, KHÔNG phải seed song song): Group Pháp chế +
// quy trình duyệt HĐ mẫu 2 bước review, đã xuất bản ở thư viện và gán cho evolu. Quy trình: bước 1 "Kế toán duyệt" CÓ hạn (due_h) và
// KHÔNG đặt nhóm chuyển cấp (⇒ mặc định chuyển cấp về Toàn quyền khi quá hạn, CR-113); bước 2 "Pháp chế duyệt" đặt tường minh nhóm
// chuyển cấp. Chủ gói (Toàn quyền = julian.bui) KHÔNG thuộc Group của bước nào ⇒ quyết bước nào cũng là "duyệt thay".
// Idempotent (on conflict / where thiếu), số câu SQL cố định. Gọi từ `writeTenantFixtures` (cổng libSampleEnabled đã chặn production).
import { compileSlotStages } from "../packs/contracts/public";
import type { Tx } from "./seed.repo";

export const CR113_TENANT = "evolu";
export const LEGAL_GROUP = {
  key: "pb-phap-che",
  name: { vi: "Phòng Pháp chế", en: "Legal" },
  members: ["edgar.nguyen", "rowan.nguyen"],
} as const;
/** Group Kế toán của fixture gốc (`ACCOUNTING.key`); nhắc lại để tránh import vòng với seed.tenant-fixtures. */
const ACCOUNTING_KEY = "pb-ke-toan";
const SLOT = "contracts.approval";
/** Def thư viện mặc định của khe (hub migration 0069) — nguồn sao chép cột phụ. */
const DEFAULT_DEF_ID = "0c105000-0000-4000-8000-000000000069";
export const CR113_DEF = {
  id: "0c113000-0000-4000-8000-000000000001",
  key: "hd-cr113-mau",
  name: "Duyệt HĐ 2 cấp (mẫu CR-113)",
} as const;

const review = (
  key: string,
  name: string,
  group: string,
  dueH: number,
  escalateKey: string | null,
  remind: number | null,
) => ({
  kind: "review" as const,
  key,
  name,
  department_group_id: null,
  department_group_key: group,
  head_only: false,
  due_h: dueH,
  remind_every_h: remind,
  escalate_group_id: null,
  escalate_group_key: escalateKey,
  exclude_starter: false,
  when: null,
});

/** `slot_body` theo MÃ Group (def thư viện không chứa id Group của tenant nào). */
export const CR113_SLOT_BODY = {
  steps: [
    // không đặt nhóm chuyển cấp ⇒ biên dịch thêm escalate mặc định về Toàn quyền (contracts-owner)
    review("ke-toan", "Kế toán duyệt", ACCOUNTING_KEY, 24, null, null),
    // đặt tường minh ⇒ thắng mặc định (không phải Toàn quyền)
    review("phap-che", "Pháp chế duyệt", LEGAL_GROUP.key, 48, "contracts-editor", 24),
  ],
};

export type Cr113FlowResult = {
  legalGroups: number;
  legalMembers: number;
  flowDefs: number;
  flowReleases: number;
  flowAssignments: number;
};

export async function writeCr113Flow(tx: Tx): Promise<Cr113FlowResult> {
  const r: Cr113FlowResult = {
    legalGroups: 0,
    legalMembers: 0,
    flowDefs: 0,
    flowReleases: 0,
    flowAssignments: 0,
  };
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

  // Thư viện + gán cần người ghi (platform admin do db:seed tạo); chưa có ⇒ bỏ qua êm (chạy lại sau).
  const [actor] = await tx`select id from admin.users
    where role = 'platform_admin' or (tenant_id = ${t.id} and role = 'tenant_admin')
    order by (role = 'platform_admin') desc, created_at, id limit 1`;
  const [base] = await tx`select 1 as ok from hub.process_defs where id = ${DEFAULT_DEF_ID}`;
  if (!actor || !base) return r;
  const body = tx.json(CR113_SLOT_BODY as never);
  const stages = tx.json(compileSlotStages(CR113_SLOT_BODY) as never);
  r.flowDefs = (
    await tx`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
        token_budget, enabled, sources, inputs, ttl_days, slot, slot_body, published_version, created_by, updated_by)
      select ${CR113_DEF.id}, null, ${CR113_DEF.key}, ${CR113_DEF.name}, description, input_hint, run_group_ids, ${stages},
        token_budget, true, sources, inputs, ttl_days, slot, ${body}, 1, ${actor.id}, ${actor.id}
      from hub.process_defs where id = ${DEFAULT_DEF_ID}
      on conflict do nothing returning id`
  ).length;
  r.flowReleases = (
    await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, published_by, note)
      select ${CR113_DEF.id}, 1, ${CR113_DEF.name}, ${stages}, ${body}, ${actor.id}, 'pm-ready: mẫu CR-113'
      where exists (select 1 from hub.process_defs where id = ${CR113_DEF.id})
      on conflict do nothing returning rel_version`
  ).length;
  // CR-120 · cr120-single-source · gán = luật `is_default` (nguồn duy nhất; bảng gán cũ nay là VIEW chỉ đọc). Tenant × khe đã có
  // luật mặc định khác mẫu khe ⇒ giữ (như `on conflict do nothing` cũ; mặc định = mẫu do `ensureSlotDefaults` cấp ⇒ thay). Một câu: tập gán + đầu luật + luật mặc định priority 49.
  r.flowAssignments = (
    await tx`with d as (
        select ${t.id}::uuid as tenant_id, ${SLOT}::text as slot, ${CR113_DEF.id}::uuid as def_id
        where exists (select 1 from hub.process_defs where id = ${CR113_DEF.id})
          and not exists (select 1 from hub.process_routing_rules x
            where x.tenant_id = ${t.id} and x.slot = ${SLOT} and (x.priority = 49 and not x.is_default
              or x.is_default and x.def_id is distinct from (select s.default_def_id from hub.process_slots s
                where s.slot = ${SLOT})))),
      a as (insert into hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
        select tenant_id, def_id, slot, ${actor.id} from d on conflict do nothing),
      h as (insert into hub.process_routings (tenant_id, slot, updated_by)
        select tenant_id, slot, ${actor.id} from d on conflict do nothing)
      insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      select tenant_id, slot, 49, '{}'::jsonb, def_id, true from d
      on conflict (tenant_id, slot) where is_default do update set def_id = excluded.def_id returning slot`
  ).length;
  await bumpIfChanged(tx, r, t.id as string);
  return r;
}

/** Group/gán mới ghi bằng SQL ⇒ báo cache cấu hình (admin + hub) như `addRole` của test; chạy lại không đổi gì ⇒ không báo. */
async function bumpIfChanged(tx: Tx, r: Cr113FlowResult, tenantId: string): Promise<void> {
  if (Object.values(r).every((n) => n === 0)) return;
  const [m] =
    await tx`update admin.config_meta set config_version = config_version + 1 returning config_version as v`;
  await tx`select pg_notify('config_changed',
    json_build_object('v', ${m?.v ?? 1}::int, 'entity', 'group', 'tenant_id', ${tenantId}::text)::text)`;
  await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

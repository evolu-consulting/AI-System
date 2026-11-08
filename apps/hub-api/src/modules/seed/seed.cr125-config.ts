// CR-125 · cr125-seed · rule D7 (cấu hình công ty đủ trọn) · phần CR-122..125 của fixture công ty (mở rộng `seed.tenant-fixtures`, KHÔNG phải
// seed song song): một công ty fixture có gói bật là chạy được từ đầu đến cuối, không công tắc tay:
//   1. mọi tính năng của app đã bật (contracts, community — gồm `contracts-partner-confirm`), trừ `han-muc-duyet` (chỉ cấp tay trên prod);
//   2. ký số demo "Ký thử" (`selfsign`): `approval_settings.esign_enabled` + nhà cung cấp mặc định. KHÔNG secret DocuSign (env `ESIGN_PROVIDERS`
//      do compose staging đặt, không nằm trong seed);
//   3. nhóm duyệt mà mẫu Thư viện trỏ tới (truong-phong, giam-doc, phong-kinh-doanh) + thành viên mẫu (khớp theo username);
//   4. mẫu Thư viện: 3 mẫu duyệt HĐ (CR-122 B) + "Quản trị duyệt bài" (CR-125 c5); 2 mẫu nhận HĐ đối tác đã có ở hub 0121;
//   5. flow mặc định của công ty (`company_flows` Bật): duyệt HĐ (Duyệt 2 cấp), nhận HĐ đối tác (Nhận HĐ thường), duyệt bài Community;
//   6. cờ `flow_triggers` BẬT cho mọi công ty có flow Bật (như hub 0126) ⇒ ops `flow_flag` không cảnh báo.
// Idempotent (on conflict / where thiếu), mỗi bước MỘT câu SQL theo tập (không theo số hàng). Gói chưa bật cho công ty ⇒ bước tương ứng bỏ qua.

import {
  bindGroupKeys,
  COMMUNITY_FLOW_TEMPLATE,
  FLOW_TEMPLATE_APP,
  FLOW_TEMPLATE_EVENT,
  FLOW_TEMPLATE_INPUTS,
  FLOW_TEMPLATES,
  groupKeysOf,
  PURCHASE_PARENT,
  PURCHASE_PARENT_ID,
  PURCHASE_PHASE_KEYS,
  PURCHASE_TEMPLATES,
} from "../processes/public";
import { TEMPLATE_GROUP_MEMBERS } from "./seed.cr125-members";
import type { Tx } from "./seed.repo";

/** Ứng dụng có tính năng được cấp tự động (khi công ty đã có `<app>-read`). */
const FEATURE_APPS = ["contracts", "community"] as const;
/** `han-muc-duyet` chỉ cấp tay trên prod; engine duyệt HĐ đã gỡ (CR-121 c18). */
const FEATURE_EXCLUDED = ["han-muc-duyet", "contracts-approval-engine"] as const;
/** Nhà cung cấp ký số demo (nhãn "Ký thử"); không bao giờ DocuSign. */
export const DEMO_ESIGN_PROVIDER = "selfsign";

/** Id mẫu "Nhận HĐ thường" (hub 0121) — flow mặc định cho sự kiện `contract.received`. */
export const RECEIVE_DEFAULT_FLOW_ID = "0c124000-0000-4000-8000-0000000000c2";
/** Id mẫu "Duyệt 2 cấp" (CR-122 B) — flow mặc định duyệt HĐ. */
export const APPROVAL_DEFAULT_FLOW_ID = "0c122000-0000-4000-8000-0000000000b1";

/** Nhóm duyệt mà các mẫu mặc định trỏ tới (mã theo mẫu; công ty không phải đổi). */
export const TEMPLATE_GROUPS = [
  { key: "truong-phong", name: { vi: "Trưởng phòng", en: "Department head" } },
  { key: "giam-doc", name: { vi: "Giám đốc", en: "Director" } },
  { key: "phong-kinh-doanh", name: { vi: "Phòng Kinh doanh", en: "Sales" } },
  // «Quy trình mua hàng» (3 mẫu Thư viện, cr125-purchase-templates): mọi mã nhóm mà Phần 1–3 trỏ tới (giam-doc đã có ở trên).
  { key: "nhan-vien-phong-ban", name: { vi: "Nhân viên phòng ban", en: "Department staff" } },
  { key: "truong-bo-phan", name: { vi: "Trưởng bộ phận", en: "Department manager" } },
  { key: "mua-hang", name: { vi: "Mua hàng", en: "Purchasing" } },
  { key: "truong-mua-hang", name: { vi: "Trưởng mua hàng", en: "Purchasing manager" } },
  { key: "tai-chinh", name: { vi: "Tài chính", en: "Finance" } },
  { key: "phap-che", name: { vi: "Pháp chế", en: "Legal" } },
  { key: "ke-toan", name: { vi: "Kế toán", en: "Accounting" } },
  { key: "ke-toan-truong", name: { vi: "Kế toán trưởng", en: "Chief accountant" } },
  { key: "kho", name: { vi: "Kho", en: "Warehouse" } },
  { key: "thu-quy", name: { vi: "Thủ quỹ", en: "Cashier" } },
] as const;

export { PURCHASE_ROLE_GROUPS, TEMPLATE_GROUP_MEMBERS } from "./seed.cr125-members";

/** Flow mặc định của công ty: gán khi công ty có tính năng đòi hỏi (cùng luật `templateReadiness`: tính năng bật mới gán). */
export const DEFAULT_FLOWS = [
  { flow_id: APPROVAL_DEFAULT_FLOW_ID, feature: "contracts-write" },
  { flow_id: RECEIVE_DEFAULT_FLOW_ID, feature: "contracts-partner-confirm" },
  { flow_id: COMMUNITY_FLOW_TEMPLATE.id, feature: "community-read" },
] as const;

export type Cr125ConfigResult = {
  features: number;
  esign: number;
  groups: number;
  groupMembers: number;
  libraryDefs: number;
  libraryReleases: number;
  companyFlows: number;
  flowFlags: number;
  esignSigners: number;
};

const ZERO: Cr125ConfigResult = {
  features: 0,
  esign: 0,
  groups: 0,
  groupMembers: 0,
  libraryDefs: 0,
  libraryReleases: 0,
  companyFlows: 0,
  flowFlags: 0,
  esignSigners: 0,
};

/** Mẫu Thư viện do seed ghi (id cố định): 3 mẫu duyệt HĐ + mẫu Community + 3 mẫu «Quy trình mua hàng». */
export const libraryRows = () => [
  ...FLOW_TEMPLATES.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    input_hint: "Mã hợp đồng",
    stages: t.stages(),
    inputs: FLOW_TEMPLATE_INPUTS,
    trigger: { event: FLOW_TEMPLATE_EVENT },
    app: FLOW_TEMPLATE_APP,
  })),
  {
    id: COMMUNITY_FLOW_TEMPLATE.id,
    key: COMMUNITY_FLOW_TEMPLATE.key,
    name: COMMUNITY_FLOW_TEMPLATE.name,
    description: COMMUNITY_FLOW_TEMPLATE.description,
    input_hint: "Mã bài",
    stages: COMMUNITY_FLOW_TEMPLATE.stages(),
    inputs: COMMUNITY_FLOW_TEMPLATE.inputs,
    trigger: { event: COMMUNITY_FLOW_TEMPLATE.event },
    app: COMMUNITY_FLOW_TEMPLATE.app,
  },
  ...[...PURCHASE_TEMPLATES, PURCHASE_PARENT].map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    input_hint: t.input_hint,
    stages: t.stages,
    inputs: t.inputs,
    trigger: t.trigger,
    app: t.app,
  })),
];

export async function writeCr125Config(
  tx: Tx,
  keys: readonly string[],
): Promise<Cr125ConfigResult> {
  const r: Cr125ConfigResult = { ...ZERO };
  r.features = await grantAppFeatures(tx, keys);
  r.esign = await enableDemoEsign(tx, keys);
  const g = await writeTemplateGroups(tx, keys);
  r.groups = g.groups;
  r.groupMembers = g.members;
  const l = await writeLibrary(tx);
  r.libraryDefs = l.defs;
  r.libraryReleases = l.releases;
  r.companyFlows = await assignDefaultFlows(tx, keys);
  r.flowFlags = await enableFlowTriggers(tx, keys);
  r.esignSigners = await writePurchaseEsignSigners(tx, keys);
  await bumpIfChanged(tx, r, keys);
  return r;
}

/** 1: mọi tính năng (không `off`) của app đã bật; công ty có `<app>-read` còn hiệu lực. Hàng đã có (kể cả đã thu hồi) giữ nguyên. */
async function grantAppFeatures(tx: Tx, keys: readonly string[]): Promise<number> {
  return (
    await tx`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
      select f.id, tn.id, null
      from admin.features f
      cross join admin.tenants tn
      where tn.key = any(${[...keys]}::text[]) and tn.active and f.status <> 'off'
        and f.app = any(${[...FEATURE_APPS]}::text[]) and f.key <> all(${[...FEATURE_EXCLUDED]}::text[])
        and exists (select 1 from admin.feature_entitlements en
          join admin.features rf on rf.id = en.feature_id and rf.key = f.app || '-read' and rf.status <> 'off'
          where en.tenant_id = tn.id and en.revoked_at is null)
      on conflict do nothing returning feature_id`
  ).length;
}

/** 2: "Ký thử" cho công ty có gói contracts. Đã bật thì giữ (kể cả nhà cung cấp mặc định đã chọn). */
async function enableDemoEsign(tx: Tx, keys: readonly string[]): Promise<number> {
  const [has] = await tx`select to_regclass('contracts.approval_settings') is not null as ok`;
  if (!has?.ok) return 0;
  return (
    await tx`insert into contracts.approval_settings (tenant_id, esign_enabled, esign_default_provider)
      select tn.id, true, ${DEMO_ESIGN_PROVIDER}
      from admin.tenants tn
      where tn.key = any(${[...keys]}::text[]) and tn.active
        and exists (select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
          where en.tenant_id = tn.id and en.revoked_at is null and f.key = 'contracts-read' and f.status <> 'off')
      on conflict (tenant_id) do update
        set esign_enabled = true,
            esign_default_provider = coalesce(contracts.approval_settings.esign_default_provider, excluded.esign_default_provider),
            updated_at = now()
        where not coalesce(contracts.approval_settings.esign_enabled, false)
          or contracts.approval_settings.esign_default_provider is null
      returning tenant_id`
  ).length;
}

/** 3: nhóm duyệt của mẫu + thành viên mẫu (khớp username). */
async function writeTemplateGroups(
  tx: Tx,
  keys: readonly string[],
): Promise<{ groups: number; members: number }> {
  const groups = (
    await tx`insert into admin.groups (tenant_id, key, name, description)
      select tn.id, x.key, x.name, 'Nhóm duyệt của mẫu quy trình mặc định (mẫu dev/test, CR-125)'
      from admin.tenants tn
      cross join jsonb_to_recordset(${tx.json(TEMPLATE_GROUPS as never)}::jsonb) as x(key text, name jsonb)
      where tn.key = any(${[...keys]}::text[]) and tn.active
      on conflict (tenant_id, key) do nothing returning id`
  ).length;
  const map = Object.entries(TEMPLATE_GROUP_MEMBERS).flatMap(([tenant, byGroup]) =>
    Object.entries(byGroup).map(([group, members]) => ({ tenant, group, members })),
  );
  const members = (
    await tx`insert into admin.group_members (tenant_id, group_id, user_id)
      select g.tenant_id, g.id, u.id
      from jsonb_to_recordset(${tx.json(map as never)}::jsonb) as x(tenant text, "group" text, members jsonb)
      join admin.tenants tn on tn.key = x.tenant
      join admin.groups g on g.tenant_id = tn.id and g.key = x."group"
      join admin.users u on u.tenant_id = tn.id and u.kind = 'internal' and u.active
        and exists (select 1 from jsonb_array_elements_text(x.members) m(v) where m.v = u.username)
      on conflict do nothing returning user_id`
  ).length;
  return { groups, members };
}

/** 4: mẫu Thư viện (def Thư viện `tenant_id NULL`, xuất bản bản 1). Id cố định + do nothing ⇒ không đè mẫu đã sửa. */
async function writeLibrary(tx: Tx): Promise<{ defs: number; releases: number }> {
  const rows = libraryRows();
  const defs = (
    await tx`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
        token_budget, enabled, sources, inputs, trigger, app, published_version)
      select x.id, null, x.key, x.name, x.description, x.input_hint, '{}'::uuid[], x.stages, null, true, '[]'::jsonb,
        x.inputs, x.trigger, x.app, 1
      from jsonb_to_recordset(${tx.json(rows as never)}::jsonb)
        as x(id uuid, key text, name text, description text, input_hint text, stages jsonb, inputs jsonb, trigger jsonb, app text)
      on conflict do nothing returning id`
  ).length;
  const releases = (
    await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
      select d.id, 1, d.name, d.stages, d.slot_body, 'seed mẫu CR-125 (cr125-seed)'
      from hub.process_defs d
      where d.id = any(${rows.map((x) => x.id)}::uuid[]) and d.published_version = 1 and d.tenant_id is null
      on conflict (def_id, rel_version) do nothing returning def_id`
  ).length;
  return { defs, releases };
}

/**
 * 5: flow mặc định (Bật) cho công ty có tính năng mà mẫu đòi. Công ty đã có flow Bật không điều kiện cho CÙNG sự kiện (vd hd-mac-dinh
 * backfill hub 0111, hoặc admin đã đổi) ⇒ không thêm flow thứ hai tranh nhau. Dòng đã có (kể cả đã Tắt) giữ nguyên.
 */
async function assignDefaultFlows(tx: Tx, keys: readonly string[]): Promise<number> {
  const byEvent = await assignEventFlows(tx, keys);
  const manual = await assignManualFlows(tx, keys);
  return byEvent + manual;
}

/**
 * «Quy trình mua hàng» (cha, bắt đầu bằng phiếu — không có sự kiện) gán cho công ty có `contracts-read`. Ba phần KHÔNG gán: chỉ chạy làm
 * lượt con của node Quy trình con (đọc thẳng từ Thư viện), nên không có flow công ty nào mở lượt theo sự kiện HĐ ⇒ không mở trùng.
 */
async function assignManualFlows(tx: Tx, keys: readonly string[]): Promise<number> {
  return (
    await tx`insert into hub.company_flows (tenant_id, flow_id, enabled, position)
      select tn.id, d.id, true, 0
      from admin.tenants tn
      join hub.process_defs d on d.id = ${PURCHASE_PARENT_ID}::uuid and d.deleted_at is null
      join admin.features ft on ft.key = 'contracts-read' and ft.status <> 'off'
      join admin.feature_entitlements en on en.feature_id = ft.id and en.tenant_id = tn.id and en.revoked_at is null
      where tn.key = any(${[...keys]}::text[]) and tn.active
      on conflict (tenant_id, flow_id) do nothing returning id`
  ).length;
}

async function assignEventFlows(tx: Tx, keys: readonly string[]): Promise<number> {
  return (
    await tx`insert into hub.company_flows (tenant_id, flow_id, enabled, position)
      select tn.id, x.flow_id, true, 0
      from admin.tenants tn
      cross join jsonb_to_recordset(${tx.json(DEFAULT_FLOWS as never)}::jsonb) as x(flow_id uuid, feature text)
      join hub.process_defs d on d.id = x.flow_id and d.deleted_at is null and d.trigger is not null
      join admin.features ft on ft.key = x.feature and ft.status <> 'off'
      join admin.feature_entitlements en on en.feature_id = ft.id and en.tenant_id = tn.id and en.revoked_at is null
      where tn.key = any(${[...keys]}::text[]) and tn.active
        and not exists (select 1 from hub.company_flows cf join hub.process_defs d2 on d2.id = cf.flow_id
          where cf.tenant_id = tn.id and cf.enabled and cf.flow_id <> x.flow_id
            and d2.trigger_event = d.trigger_event and not (d2.trigger ? 'when'))
      on conflict (tenant_id, flow_id) do nothing returning id`
  ).length;
}

/** 6: như hub 0126 — công ty có flow Bật thì cờ `flow_triggers` BẬT (không đụng công ty khác; hàng đã Bật không đổi `updated_at`). */
async function enableFlowTriggers(tx: Tx, keys: readonly string[]): Promise<number> {
  return (
    await tx`insert into hub.tenant_flow_settings (tenant_id, flow_triggers)
      select distinct f.tenant_id, true
      from hub.company_flows f join admin.tenants tn on tn.id = f.tenant_id
      where f.enabled and tn.key = any(${[...keys]}::text[])
      on conflict (tenant_id) do update set flow_triggers = true, updated_at = now()
        where not hub.tenant_flow_settings.flow_triggers
      returning tenant_id`
  ).length;
}

/** Mã quy trình con «Hợp đồng» (Phần 2) và nhóm ký phía công ty (Giám đốc) của «Quy trình mua hàng». */
const PURCHASE_CONTRACT_KEY = PURCHASE_PHASE_KEYS[1];
export const PURCHASE_SIGNER_GROUP = "giam-doc";

/** Điền người ký công ty (`group:<id>`) vào mọi bước gửi ký số (`contracts-esign-send`) còn trống. THUẦN. */
export function withEsignSigner(stages: readonly unknown[], groupId: string): unknown[] {
  return stages.map((s) => {
    const ex = (s as { executor?: { tool_key?: string; args?: Record<string, unknown> } }).executor;
    if (ex?.tool_key !== "contracts-esign-send") return s;
    const cur = ex.args?.company_signers as { value?: unknown } | undefined;
    if (typeof cur?.value === "string" && cur.value.trim() !== "") return s;
    const args = { ...ex.args, company_signers: { from: "const", value: `group:${groupId}` } };
    return { ...(s as object), executor: { ...ex, args } };
  });
}

/**
 * 7 (CR-126 · D7): bước «Ký số» của Phần 2 «Hợp đồng» cần người ký công ty — mẫu Thư viện không mang được id nhóm, nên (như nút «Sao chép để
 * sửa» của công ty) công ty có nhóm Giám đốc nhận bản riêng của Phần 2 (id nhóm thật, người ký = nhóm Giám đốc; lượt con ưu tiên bản công ty).
 * Đã có bản công ty cùng mã (kể cả admin đã sửa) ⇒ giữ nguyên. Số câu SQL theo công ty (không theo hàng).
 */
async function writePurchaseEsignSigners(tx: Tx, keys: readonly string[]): Promise<number> {
  const todo = await tx<
    { tid: string; gid: string; lib: string }[]
  >`select tn.id as tid, g.id as gid, d.id as lib
    from admin.tenants tn
    join admin.groups g on g.tenant_id = tn.id and g.key = ${PURCHASE_SIGNER_GROUP}
    join hub.process_defs d on d.tenant_id is null and d.key = ${PURCHASE_CONTRACT_KEY} and d.deleted_at is null
      and d.published_version is not null
    where tn.key = any(${[...keys]}::text[]) and tn.active
      and not exists (select 1 from hub.process_defs o
        where o.tenant_id = tn.id and o.key = ${PURCHASE_CONTRACT_KEY} and o.deleted_at is null)`;
  let n = 0;
  for (const t of todo) {
    const [lib] = await tx<{ stages: unknown[] }[]>`select r.stages from hub.process_def_releases r
      join hub.process_defs d on d.id = r.def_id and r.rel_version = d.published_version where d.id = ${t.lib}`;
    if (!lib) continue;
    const groups = await tx<{ id: string; key: string }[]>`select id, key from admin.groups
      where tenant_id = ${t.tid} and key = any(${groupKeysOf(lib.stages)}::text[])`;
    const b = bindGroupKeys(lib.stages, new Map(groups.map((g) => [g.key, g.id])), { strip: true });
    const stages = withEsignSigner(b.stages, t.gid); // nhóm duyệt thiếu ⇒ group_id null (admin chọn lại), vẫn có người ký
    n += (
      await tx`insert into hub.process_defs (tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget,
          enabled, sources, inputs, ttl_days, trigger, app, source_template_id, source_rel_version)
        select ${t.tid}, d.key, d.name, d.description, d.input_hint, '{}'::uuid[], ${tx.json(stages as never)}::jsonb, d.token_budget,
          true, coalesce(d.sources, '[]'::jsonb), coalesce(d.inputs, '[]'::jsonb), d.ttl_days, d.trigger, d.app, d.id, d.published_version
        from hub.process_defs d where d.id = ${t.lib} returning id`
    ).length;
  }
  return n;
}

/** Entitlement/nhóm/flow mới ghi bằng SQL ⇒ báo cache cấu hình (admin + hub); chạy lại không đổi gì ⇒ không báo. */
async function bumpIfChanged(tx: Tx, r: Cr125ConfigResult, keys: readonly string[]): Promise<void> {
  const touched =
    r.features +
    r.groups +
    r.groupMembers +
    r.companyFlows +
    r.flowFlags +
    r.esign +
    r.esignSigners;
  if (touched === 0 && r.libraryDefs === 0) return;
  await notifyConfigChanged(tx, keys);
}

/**
 * CR-126 · cr126-child-task-visible · báo cache cấu hình (admin + hub) như màn thành viên nhóm của admin-api: ghi nhóm/thành viên bằng SQL
 * mà KHÔNG báo ⇒ Hub giữ `groupIds` cũ của người đã đăng nhập ⇒ việc giao cho nhóm không hiện trong «Chờ tôi duyệt». Một luật cho seed + e2e.
 */
export async function notifyConfigChanged(tx: Tx, keys: readonly string[]): Promise<void> {
  const [m] =
    await tx`update admin.config_meta set config_version = config_version + 1 returning config_version as v`;
  await tx`select pg_notify('config_changed',
    json_build_object('v', ${m?.v ?? 1}::int, 'entity', 'entitlement', 'tenant_id', tn.id::text)::text)
    from admin.tenants tn where tn.key = any(${[...keys]}::text[])`;
  await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

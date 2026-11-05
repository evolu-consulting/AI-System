// CR-120 (part F) · ops-checks · "Quy trình hiển thị cho tenant" (`flow_coverage`): bất biến dữ liệu bắt dữ liệu lệch TỰ ĐỘNG thay vì để
// người dùng thấy. Sự cố gốc: tenant Demo không thấy quy trình vì danh sách tenant thấy đọc `hub.process_tenant_defs` (hub 0087) còn
// việc gán của nó nằm ở bảng cũ `process_slot_assignments`.
// Với MỖI (tenant bật gói của khe, khe quy trình đã đăng ký — trừ `dlc.*`, của Rowan): phải có quy trình trong danh sách tenant thấy
// (đúng thứ `GET .../routing` trả `processes`: hàng `process_tenant_defs` mà def chưa xoá mềm). Thiếu ⇒ crit kèm tên tenant + khe.
// "Hiệu lực" = luật định tuyến ∨ mẫu khe (cr120-single-source: gán cũ nay là VIEW dẫn xuất từ luật ⇒ không đọc riêng); danh sách
// thấy được rỗng nhưng vẫn có đường chạy (mẫu khe — tenant chưa được `ensureSlotDefaults` cấp) là đúng ca Demo ⇒ cũng crit (chạy được
// mà tenant không xem/sửa được). Một câu SQL tập hợp (Luật 4c), không ngưỡng.

import { packFeatureKey } from "@ai/contracts";
import { sql } from "drizzle-orm";
import { APPROVAL_PROCESS_KEY } from "../../../packs/contracts/domain/approval-flow.rules";
import { APPROVAL_SLOT } from "../../../packs/contracts/domain/approval-slot.rules";
import { slotRegistry } from "../../../packs/kit/adapters/slot-registry";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

/** Một (tenant × khe) vi phạm. `effective`: vẫn có đường chạy (luật/gán mới/mặc định khe/gán cũ) dù danh sách thấy được rỗng. */
export type CoverageGap = { slot: string; tenant: string; effective: boolean };
export type CoverageAgg = {
  checked: number;
  gap_count: number;
  gaps: CoverageGap[];
  /** CR-121 D-4 · tên công ty còn lượt duyệt HĐ trên engine đang chạy nhưng khe `contracts.approval` KHÔNG còn quy trình gán nào (gỡ gán giữa chừng). */
  unrouted?: string[];
  /** CR-121 D-4 · tên công ty có quy trình đã gán nhưng không chạy được: quy trình của luật bị xoá/chưa xuất bản, hoặc run duyệt HĐ kẹt `needs_decision`. */
  broken?: string[];
};
export type CoverageSlot = { slot: string; feature: string };

export const GAPS_SHOWN = 20;
const NAMES_IN_MESSAGE = 5;

const HINT =
  "Gán quy trình cho tenant ở admin › Quy trình nghiệp vụ (Được platform gán); tenant bật app được hub cấp mặc định khe khi khởi động / khi cấu hình đổi (ensureSlotDefaults) — kiểm mẫu khe đã xuất bản rồi kiểm lại.";

const APPROVAL_FIX_HINT =
  "Vào Admin › Công ty › Quy trình: gán (hoặc gán lại) quy trình cho khe Duyệt hợp đồng, xuất bản lại quy trình bị xoá, rồi mở lại các lượt duyệt kẹt.";

const namesOf = (xs: readonly string[]): string =>
  `${xs.slice(0, NAMES_IN_MESSAGE).join(", ")}${xs.length > NAMES_IN_MESSAGE ? ` và ${xs.length - NAMES_IN_MESSAGE} nữa` : ""}`;

/** CR-121 D-4 · các đoạn thông điệp cho cấu hình duyệt HĐ nửa vời (rỗng ⇒ bỏ đoạn). */
function approvalConfigParts(unrouted: readonly string[], broken: readonly string[]): string[] {
  const parts: string[] = [];
  if (unrouted.length > 0)
    parts.push(
      `${unrouted.length} công ty còn hợp đồng đang duyệt theo quy trình nhưng khe duyệt hợp đồng không còn quy trình gán: ${namesOf(unrouted)}`,
    );
  if (broken.length > 0)
    parts.push(
      `${broken.length} công ty có quy trình duyệt hợp đồng không chạy được (quy trình bị xoá/chưa xuất bản hoặc lượt duyệt kẹt): ${namesOf(broken)}`,
    );
  return parts;
}
/** Thuần. */
export function evaluateFlowCoverage(a: CoverageAgg): OpsCheckResult {
  const unrouted = a.unrouted ?? [];
  const broken = a.broken ?? [];
  const value = { checked: a.checked, gap_count: a.gap_count, gaps: a.gaps, unrouted, broken };
  if (unrouted.length > 0 || broken.length > 0) {
    const r = evaluateFlowCoverage({ ...a, unrouted: [], broken: [] });
    const parts = approvalConfigParts(unrouted, broken);
    return {
      status: "crit",
      value,
      message: `${parts.join(" · ")}${r.status === "crit" ? ` · ${r.message}` : ""}`,
      hint: `${APPROVAL_FIX_HINT} ${r.status === "crit" ? HINT : ""}`.trim(),
    };
  }
  if (a.gap_count === 0) {
    return {
      status: "ok",
      value,
      message:
        a.checked === 0
          ? "Chưa có tenant nào bật gói có khe quy trình"
          : `${a.checked} tenant × khe đều có quy trình hiển thị`,
    };
  }
  const names = a.gaps.slice(0, NAMES_IN_MESSAGE).map((g) => `${g.tenant} (${g.slot})`);
  const more = a.gap_count - names.length;
  const hidden = a.gaps.filter((g) => g.effective).length;
  return {
    status: "crit",
    value,
    message: `${a.gap_count}/${a.checked} tenant × khe không có quy trình hiển thị: ${names.join(", ")}${more > 0 ? ` và ${more} nữa` : ""}${hidden > 0 ? " — có đường chạy nhưng danh sách tenant rỗng (chưa backfill process_tenant_defs?)" : ""}`,
    hint: HINT,
  };
}

/**
 * Một câu, văn bản cố định; khe qua MỘT tham số JSON `[{slot, feature}]`. `t` = tenant đang bật gói (entitlement `<gói>-read` chưa
 * thu hồi, feature không `off`, tenant active); các `exists` tra theo PK/index (tenant, slot). Trả tổng số cặp, số cặp thiếu, và tối đa
 * `GAPS_SHOWN` cặp đầu (theo tên tenant, khe).
 */
export const flowCoverageQuery = (slots: readonly CoverageSlot[]) => sql`
  with s as (
    select e->>'slot' as slot, e->>'feature' as feature from jsonb_array_elements(${JSON.stringify(slots)}::jsonb) e),
  t as (
    select s.slot, en.tenant_id, coalesce(nullif(tn.name, ''), tn.key) as tenant
    from s
    join admin.features f on f.key = s.feature and f.status <> 'off'
    join admin.feature_entitlements en on en.feature_id = f.id and en.revoked_at is null
    join admin.tenants tn on tn.id = en.tenant_id and tn.active),
  m as (
    select t.slot, t.tenant,
      exists (select 1 from hub.process_tenant_defs a
              join hub.process_defs d on d.id = a.def_id and d.deleted_at is null
              where a.tenant_id = t.tenant_id and a.slot = t.slot) as visible,
      (exists (select 1 from hub.process_routing_rules r where r.tenant_id = t.tenant_id and r.slot = t.slot)
        or exists (select 1 from hub.process_slots ps
                   join hub.process_defs d on d.id = ps.default_def_id and d.deleted_at is null where ps.slot = t.slot))
        as effective
    from t)
  select
    (select count(*) from m)::int as checked,
    (select count(*) from m where not visible)::int as gap_count,
    coalesce((select jsonb_agg(jsonb_build_object('slot', g.slot, 'tenant', g.tenant, 'effective', g.effective)
                               order by g.tenant, g.slot)
              from (select * from m where not visible order by tenant, slot limit ${GAPS_SHOWN}) g), '[]'::jsonb) as gaps`;

const ACTIVE_RUN = sql`('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;

/**
 * CR-121 D-4 · cấu hình duyệt HĐ nửa vời (gán ⇒ engine chạy, không còn feature). Một câu theo tập, hai danh sách tên công ty:
 * - `unrouted`: còn run duyệt HĐ đang chạy (def tenant `contracts-approval`) mà khe không còn luật định tuyến nào (gỡ gán giữa chừng).
 * - `broken`: có luật cho khe mà quy trình của luật đã xoá mềm / chưa xuất bản (HĐ mới bị chặn `FLOW_ROUTE_UNAVAILABLE`), hoặc có run
 *   duyệt HĐ kẹt `needs_decision`.
 * (Hub không đọc được `contracts.approvals` — cách ly gói — nên HĐ chờ duyệt chạy máy cũ của công ty chưa gán không đếm ở đây.)
 */
export const approvalConfigQuery = () => sql`
  with ad as (
    select d.id as def_id, d.tenant_id from hub.process_defs d
    where d.key = ${APPROVAL_PROCESS_KEY} and d.source_ref is not null and d.tenant_id is not null),
  un as (
    select distinct ad.tenant_id from ad
    where exists (select 1 from hub.process_runs r where r.tenant_id = ad.tenant_id and r.process_def_id = ad.def_id
                  and r.status in ${ACTIVE_RUN})
      and not exists (select 1 from hub.process_routing_rules x where x.tenant_id = ad.tenant_id and x.slot = ${APPROVAL_SLOT})),
  bk as (
    select r.tenant_id from hub.process_routing_rules r join hub.process_defs d on d.id = r.def_id
    where r.slot = ${APPROVAL_SLOT} and (d.deleted_at is not null or d.published_version is null)
    union
    select ad.tenant_id from ad
    where exists (select 1 from hub.process_runs r where r.tenant_id = ad.tenant_id and r.process_def_id = ad.def_id
                  and r.status = 'needs_decision'))
  select
    coalesce((select jsonb_agg(n order by n) from (
      select coalesce(nullif(tn.name, ''), tn.key) as n from admin.tenants tn
      where tn.active and tn.id in (select tenant_id from un)) x), '[]'::jsonb) as unrouted,
    coalesce((select jsonb_agg(n order by n) from (
      select coalesce(nullif(tn.name, ''), tn.key) as n from admin.tenants tn
      where tn.active and tn.id in (select tenant_id from bk)) y), '[]'::jsonb) as broken`;

/** Khe cần kiểm: đã đăng ký (gói đã mount), bỏ `dlc.*` (Rowan) và khe opt-in (không có mặc định ⇒ chưa gán là bình thường). */
export const coverageSlotsOf = (
  list: () => readonly { key: string; packKey: string; optIn?: boolean | undefined }[],
): CoverageSlot[] =>
  list()
    .filter((s) => !s.key.startsWith("dlc.") && !s.optIn)
    .map((s) => ({ slot: s.key, feature: packFeatureKey(s.packKey, "read") }));

export function makeFlowCoverageCheck(
  list: () => readonly {
    key: string;
    packKey: string;
    optIn?: boolean | undefined;
  }[] = () => slotRegistry.list(),
): OpsCheck {
  return {
    key: "flow_coverage",
    async run(d) {
      const slots = coverageSlotsOf(list);
      if (slots.length === 0) return evaluateFlowCoverage({ checked: 0, gap_count: 0, gaps: [] });
      const [r, e] = await systemRead(d.db, async (tx) => [
        (await tx.execute<CoverageAgg>(flowCoverageQuery(slots)))[0],
        (await tx.execute<{ unrouted: string[]; broken: string[] }>(approvalConfigQuery()))[0],
      ]);
      return evaluateFlowCoverage({
        ...(r ?? { checked: 0, gap_count: 0, gaps: [] }),
        unrouted: e?.unrouted ?? [],
        broken: e?.broken ?? [],
      });
    },
  };
}

export const flowCoverageCheck: OpsCheck = makeFlowCoverageCheck();

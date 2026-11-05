// CR-120 (part F) · ops-checks · "Quy trình hiển thị cho tenant" (`flow_coverage`): bất biến dữ liệu bắt dữ liệu lệch TỰ ĐỘNG thay vì để
// người dùng thấy. Sự cố gốc: tenant Demo không thấy quy trình vì danh sách tenant thấy đọc `hub.process_tenant_defs` (hub 0087) còn
// việc gán của nó nằm ở bảng cũ `process_slot_assignments`.
// Với MỖI (tenant bật gói của khe, khe quy trình đã đăng ký — trừ `dlc.*`, của Rowan): phải có quy trình trong danh sách tenant thấy
// (đúng thứ `GET .../routing` trả `processes`: hàng `process_tenant_defs` mà def chưa xoá mềm). Thiếu ⇒ crit kèm tên tenant + khe.
// "Hiệu lực" = luật định tuyến ∨ quy trình đã gán ∨ mặc định khe ∨ gán cũ; danh sách thấy được rỗng nhưng vẫn có đường chạy (mặc định
// khe / gán cũ) là đúng ca Demo ⇒ cũng crit (chạy được mà tenant không xem/sửa được). Một câu SQL tập hợp (Luật 4c), không ngưỡng.

import { packFeatureKey } from "@ai/contracts";
import { sql } from "drizzle-orm";
import { slotRegistry } from "../../../packs/kit/adapters/slot-registry";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

/** Một (tenant × khe) vi phạm. `effective`: vẫn có đường chạy (luật/gán mới/mặc định khe/gán cũ) dù danh sách thấy được rỗng. */
export type CoverageGap = { slot: string; tenant: string; effective: boolean };
export type CoverageAgg = { checked: number; gap_count: number; gaps: CoverageGap[] };
export type CoverageSlot = { slot: string; feature: string };

export const GAPS_SHOWN = 20;
const NAMES_IN_MESSAGE = 5;

const HINT =
  "Gán quy trình cho tenant ở admin › Quy trình nghiệp vụ (Được platform gán); dữ liệu cũ ở process_slot_assignments cần chép sang process_tenant_defs (backfill) rồi kiểm lại.";

/** Thuần. */
export function evaluateFlowCoverage(a: CoverageAgg): OpsCheckResult {
  const value = { checked: a.checked, gap_count: a.gap_count, gaps: a.gaps };
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
                   join hub.process_defs d on d.id = ps.default_def_id and d.deleted_at is null where ps.slot = t.slot)
        or exists (select 1 from hub.process_slot_assignments l
                   join hub.process_defs d on d.id = l.def_id and d.deleted_at is null
                   where l.tenant_id = t.tenant_id and l.slot = t.slot)) as effective
    from t)
  select
    (select count(*) from m)::int as checked,
    (select count(*) from m where not visible)::int as gap_count,
    coalesce((select jsonb_agg(jsonb_build_object('slot', g.slot, 'tenant', g.tenant, 'effective', g.effective)
                               order by g.tenant, g.slot)
              from (select * from m where not visible order by tenant, slot limit ${GAPS_SHOWN}) g), '[]'::jsonb) as gaps`;

/** Khe cần kiểm: đã đăng ký (gói đã mount), bỏ `dlc.*` (Rowan). */
export const coverageSlotsOf = (
  list: () => readonly { key: string; packKey: string }[],
): CoverageSlot[] =>
  list()
    .filter((s) => !s.key.startsWith("dlc."))
    .map((s) => ({ slot: s.key, feature: packFeatureKey(s.packKey, "read") }));

export function makeFlowCoverageCheck(
  list: () => readonly { key: string; packKey: string }[] = () => slotRegistry.list(),
): OpsCheck {
  return {
    key: "flow_coverage",
    async run(d) {
      const slots = coverageSlotsOf(list);
      if (slots.length === 0) return evaluateFlowCoverage({ checked: 0, gap_count: 0, gaps: [] });
      const [r] = await systemRead(d.db, (tx) => tx.execute<CoverageAgg>(flowCoverageQuery(slots)));
      return evaluateFlowCoverage(r ?? { checked: 0, gap_count: 0, gaps: [] });
    },
  };
}

export const flowCoverageCheck: OpsCheck = makeFlowCoverageCheck();

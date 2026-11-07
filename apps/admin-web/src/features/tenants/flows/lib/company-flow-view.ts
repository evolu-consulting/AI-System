// CR-122 · U2 · FLOW2-FR-05..09/20: logic thuần của danh sách flow công ty — nhóm theo app, nhãn trạng thái + lý do, hành động hợp lệ
// theo dòng, đổi thứ tự trong nhóm, câu lỗi nghiệp vụ của 409. Không React, không gọi API.
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";

export type FlowGroup = { app: string; items: CompanyFlowRow[] };

/** Nhóm theo app, giữ thứ tự xuất hiện của app và `position` trong nhóm. */
export function groupByApp(rows: readonly CompanyFlowRow[]): FlowGroup[] {
  const out: FlowGroup[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.app === r.app);
    if (g) g.items.push(r);
    else out.push({ app: r.app, items: [r] });
  }
  for (const g of out) g.items.sort((a, b) => a.position - b.position);
  return out;
}

/** Khoá i18n (`tenants.companyFlows.*`) của trạng thái: bật ⇒ `on`; tắt ⇒ `off.<lý do>` (luôn nói lý do — Luật gốc 3). */
export const statusKey = (r: Pick<CompanyFlowRow, "enabled" | "off_reason">): string =>
  r.enabled ? "on" : `off.${r.off_reason ?? "turned_off"}`;

export type RowActions = {
  open: true;
  toggle: boolean;
  clone: boolean;
  revert: boolean;
};

/**
 * Hành động hợp lệ của dòng: Sao chép chỉ cho flow được gán (chỉ xem); Quay về bản gốc chỉ cho bản công ty (cần có nguồn và đang
 * bật). CR-123 FR-10: bản công ty KHÔNG có Xuất bản/Bật riêng — "Lưu và áp dụng" ở trình sửa là đường duy nhất; chỉ còn Tắt khi đang bật.
 * Bật/Tắt đầy đủ chỉ cho flow được gán từ Thư viện.
 */
export const actionsOf = (r: CompanyFlowRow): RowActions => ({
  open: true,
  toggle: r.kind === "assigned" || r.enabled,
  clone: r.kind === "assigned",
  revert: r.kind === "company" && r.source !== null && r.enabled,
});

/** Đổi chỗ `fromId` tới vị trí của `toId` trong cùng app; trả danh sách id TOÀN BỘ (mọi app) theo thứ tự mới, hoặc null nếu không đổi. */
export function reorderIds(
  rows: readonly CompanyFlowRow[],
  fromId: string,
  toId: string,
): string[] | null {
  const from = rows.find((r) => r.id === fromId);
  const to = rows.find((r) => r.id === toId);
  if (!from || !to || from.id === to.id || from.app !== to.app) return null;
  const groups = groupByApp(rows);
  const g = groups.find((x) => x.app === from.app);
  if (!g) return null;
  const ids = g.items.map((x) => x.id);
  ids.splice(ids.indexOf(fromId), 1);
  ids.splice(
    ids.indexOf(toId) + (ids.indexOf(toId) >= 0 && from.position < to.position ? 1 : 0),
    0,
    fromId,
  );
  return groups.flatMap((x) => (x.app === from.app ? ids : x.items.map((i) => i.id)));
}

const ERR: Record<string, string> = {
  FLOW_REQUIRED_LAST: "requiredLast",
  FLOW_PAIR_ACTIVE: "pairActive",
  FLOW_NOT_PUBLISHED: "notPublished",
  FLOW_GROUP_MISSING: "groupMissing",
  FLOW_NOT_ASSIGNABLE: "notAssignable",
};
/** Mã lỗi Hub → khoá i18n `tenants.companyFlows.err.*` (lạ ⇒ `generic`). */
export const errorKey = (code: string | undefined): string => ERR[code ?? ""] ?? "generic";

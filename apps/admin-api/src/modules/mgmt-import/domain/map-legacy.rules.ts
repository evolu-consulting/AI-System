// I1 · vùng chờ `contracts.legacy_records`: bản ghi mgmt-app CHƯA có bảng đích (danh bạ công ty, báo giá/sourcing, góp ý,
// cấu hình + lịch sử chấm điểm, quét thị trường, file chat, hội thoại trợ lý, thông báo, hẹn nhắc ngoài CKS, giá thị trường
// không phải CKS, danh mục hàng) giữ NGUYÊN VĂN (jsonb) theo tenant, khoá (kind, mgmt_id) ⇒ không mất dữ liệu khi tắt
// mgmt-app; lát sau đọc từ đây. Thông báo không phát lại (tránh gửi lại email/push). Thuần.

import { docsOf } from "./context";
import { eachOrgDoc, type MapRun } from "./each.rules";
import type { Membership } from "./map-identity.rules";
import { bump, push, tenantPlan } from "./plan";
import { jsonSafe, lowerEmail } from "./values.rules";

/** index mgmt ⇒ kind trong vùng chờ (bản ghi có `org_id`). */
export const STAGED_INDICES = [
  "companies",
  "quotes",
  "feedback",
  "score_configs",
  "score_config_history",
  "score_snapshots",
  "market_scans",
  "chat_files",
  "catalogs",
] as const;

const stage = (kind: string, id: string, doc: unknown) => ({
  kind,
  mgmt_id: id.slice(0, 300),
  doc: jsonSafe(doc),
});

export function mapLegacy(
  run: MapRun,
  members: Map<string, Membership>,
  movedFollowups: Set<string>,
): void {
  const { s, ctx, p } = run;
  for (const ix of STAGED_INDICES)
    eachOrgDoc({ s, ctx, p }, ix, (d, t) =>
      push(t, "contracts.legacy_records", stage(ix, d.id, d.src)),
    );
  eachOrgDoc({ s, ctx, p }, "followups", (d, t) => {
    if (!movedFollowups.has(d.id))
      push(t, "contracts.legacy_records", stage("followups", d.id, d.src));
  });
  eachOrgDoc({ s, ctx, p }, "market_observations", (d, t) => {
    if (d.src.product_kind !== "cks")
      push(t, "contracts.legacy_records", stage("market_observations", d.id, d.src));
  });
  eachOrgDoc({ s, ctx, p }, "chats", (d, t) =>
    push(t, "contracts.legacy_records", stage("chats", d.id, d.src)),
  );
  for (const d of docsOf(s, "notifications")) {
    const m = members.get(lowerEmail(d.src.user_email) ?? "");
    const tid = m ? ctx.tenantOf(m.orgId) : null;
    if (!tid || !m) {
      bump(p.noTenant, "notifications");
      continue;
    }
    push(
      tenantPlan(p, tid, m.orgId),
      "contracts.legacy_records",
      stage("notifications", d.id, d.src),
    );
  }
}

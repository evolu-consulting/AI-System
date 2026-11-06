// CR-122 · P11b · sự kiện KẾT THÚC mà không mở được lượt nào (0 flow khớp / bị từ chối / hết lượt thử / lease_exhausted) ⇒ báo app qua
// `OutcomeHandler.notLaunched` để bản ghi không kẹt mãi ở "đang mở quy trình" (vd thẻ duyệt HĐ ghi lý do nghiệp vụ + cho Mở lại).
// Lý do = mã máy (web dịch sang câu nghiệp vụ, kèm cách sửa). Gọi TRONG tx chốt lô; chỉ hàng lỗi (ít) ⇒ không ảnh hưởng đường nóng.
import type { Tx } from "@ai/db";
import { outcomeHandlerFor } from "../adapters/runs/flow-ports";

export const NL_NOT_ASSIGNED = "FLOW_NOT_ASSIGNED";
export const NL_REFUSED = "FLOW_REFUSED";
export const NL_START_FAILED = "FLOW_START_FAILED";

export type NotLaunched = { tenantId: string; event: string; ref: string; reason: string };

/** Lý do (mã) khi một sự kiện cờ BẬT chốt xong mà không có lượt; còn lượt / còn thử lại ⇒ null. Thuần. */
export function notLaunchedReason(o: {
  planned: number;
  ran: number;
  refused: readonly string[];
  errors: number;
  retrying: boolean;
  noActor: boolean;
}): string | null {
  if (o.ran > 0 || o.retrying) return null;
  if (o.planned === 0) return NL_NOT_ASSIGNED;
  if (o.noActor) return NL_REFUSED;
  if (o.errors > 0) return NL_START_FAILED;
  const g = o.refused.find((r) => r.startsWith("group_missing:"));
  if (g) return `FLOW_GROUP_MISSING:${g.slice("group_missing:".length)}`;
  return o.refused.length > 0 ? NL_REFUSED : null;
}

/** Báo app cho từng sự kiện không mở được lượt (handler theo `(app, sự kiện)`; vắng ⇒ bỏ qua). */
export async function notifyNotLaunched(
  tx: Tx,
  appOf: (event: string) => string | undefined,
  items: readonly NotLaunched[],
): Promise<void> {
  for (const i of items) {
    const app = appOf(i.event);
    const h = app ? outcomeHandlerFor(app, i.event) : undefined;
    if (h?.notLaunched) await h.notLaunched(tx, i);
  }
}

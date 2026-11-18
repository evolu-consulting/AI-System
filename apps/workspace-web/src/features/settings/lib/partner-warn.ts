// CR-185 · điều kiện gửi / nhận HĐ với đối tác thành CẢNH BÁO ở Cài đặt › Quy trình duyệt (thay mục «Kết nối»). Cùng luật `partnerChecklist` với Quản trị:
// ở đây chỉ chọn điều kiện THIẾU liên quan tới từng quy trình. Chỉ quản trị công ty có dữ liệu (API chỉ cho quản trị); thành viên khác ⇒ checklist null ⇒ không cảnh báo.
import type { PartnerChecklist, PartnerItemKey, PartnerWho } from "@ai/contracts/modules";
import type { CurrentFlow } from "./current-flow";

export type PartnerWarn = { what: PartnerItemKey[]; who: PartnerWho[] };

/** Quy trình có bước «Gửi đối tác xác nhận». */
export const hasPartnerSend = (f: Pick<CurrentFlow, "graph" | "partnerSend">): boolean =>
  f.partnerSend || f.graph.some((g) => g.kind === "partner_send");

/** Điều kiện GỬI còn thiếu (trừ «có quy trình gửi»: quy trình này chính là nó); chưa đọc được (`unknown`) không tính. null ⇒ không cảnh báo. */
export function sendWarn(
  c: PartnerChecklist | null,
  f: Pick<CurrentFlow, "graph" | "partnerSend">,
): PartnerWarn | null {
  if (!c || !hasPartnerSend(f)) return null;
  const todo = c.items.filter(
    (i) => i.state === "todo" && i.key !== "send_flow" && (i.need === "send" || i.need === "both"),
  );
  if (todo.length === 0) return null;
  return { what: todo.map((i) => i.key), who: [...new Set(todo.map((i) => i.who))] };
}

/** Tính năng đã bật cho công ty mà chưa có quy trình «Nhận HĐ» ⇒ cảnh báo ở đầu mục (tính năng tắt ⇒ công ty không dùng đối tác, không nhắc). */
export const receiveWarn = (c: PartnerChecklist | null): boolean =>
  c !== null && c.on && c.items.some((i) => i.key === "receive_flow" && i.state === "todo");

// one-agent · cổng "nhãn ngữ cảnh" của gói (lớp 2, chỉ kiểu): dock của app gửi id bản ghi đang xem; Hub hỏi gói tên ngắn của
// bản ghi đó bằng `PackUow` của gói (role gói + RLS của NGƯỜI GỌI). Không thấy / không có ⇒ null (Hub bỏ, không chèn gì).
import type { ContextEntityKind } from "../domain/context-kind.rules";

export type ContextWho = { tenantId: string; userId: string };

export type ContextSource = {
  /** Gói nguồn — Hub chỉ hỏi khi gói bật cho tenant ∧ người gọi có quyền đọc gói. */
  pack: string;
  kinds: readonly ContextEntityKind[];
  /** Nhãn một dòng (tên, số, hạn…) của bản ghi người gọi thấy; không thấy ⇒ null. `id` đã kiểm dạng theo `kind`. */
  label(who: ContextWho, kind: ContextEntityKind, id: string): Promise<string | null>;
};

/** Cổng Hub lõi dùng (registry tool gói cài đặt). */
export type ContextLabeler = {
  contextLabel(who: ContextWho, kind: ContextEntityKind, id: string): Promise<string | null>;
};

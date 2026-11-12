// ADM-FR-60 · trạng thái rỗng: hình minh hoạ + (tiêu đề đậm) + câu mô tả + nút tạo (tuỳ chọn); rỗng do lọc (kind="search") có "Xoá bộ lọc".
// CR-131: lớp mỏng trên EmptyState dùng chung của web-kit (một khái niệm = một component ở mọi app).
import { EmptyState as KitEmptyState } from "@ai/web-kit/ui/EmptyState";
import type { ReactNode } from "react";

type Props = {
  message: string;
  /** Dòng tiêu đề đậm phía trên câu mô tả (mockup P-d2 C3). */
  title?: string;
  /** `search` = lọc không ra; mặc định `empty` = chưa có dữ liệu. */
  kind?: "empty" | "search" | "off";
  action?: ReactNode;
};

export function EmptyState({ message, title, kind = "empty", action }: Props) {
  return (
    <KitEmptyState
      kind={kind}
      title={title ?? message}
      hint={title ? message : undefined}
      action={action}
    />
  );
}

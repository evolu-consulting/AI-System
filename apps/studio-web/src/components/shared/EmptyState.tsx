// HUB-FR-72 · trạng thái rỗng: hình + câu mô tả + nút tuỳ chọn. CR-131: lớp mỏng trên EmptyState dùng chung của web-kit.
import { EmptyState as KitEmptyState } from "@ai/web-kit/ui/EmptyState";
import type { ReactNode } from "react";

type Props = { message: string; kind?: "empty" | "search" | "off"; action?: ReactNode };

export function EmptyState({ message, kind = "empty", action }: Props) {
  return <KitEmptyState kind={kind} title={message} action={action} />;
}

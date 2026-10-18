// ADM-FR-60 · trạng thái rỗng: icon + (tiêu đề đậm) + câu mô tả + nút tạo (tuỳ chọn); rỗng do lọc có "Xoá bộ lọc".
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  message: string;
  /** Dòng tiêu đề đậm phía trên câu mô tả (mockup P-d2 C3). */
  title?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ message, title, icon: Icon = Inbox, action, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <Icon aria-hidden className="size-8 text-primary/50" />
      <div className="max-w-md space-y-1">
        {title ? <p className="text-body font-semibold text-foreground">{title}</p> : null}
        <p className="text-body text-muted-foreground">{message}</p>
      </div>
      {action}
    </div>
  );
}

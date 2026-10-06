// HUB-FR-72 · trạng thái rỗng: icon + câu mô tả + nút tuỳ chọn.
import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = { message: string; icon?: LucideIcon; action?: ReactNode };

export function EmptyState({ message, icon: Icon = Inbox, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <Icon aria-hidden className="size-8 text-primary/50" />
      <p className="max-w-md text-body text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

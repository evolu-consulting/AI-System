// CR-121 C-6 · nút nổi trợ lý AI DUY NHẤT của mọi module (Sổ Hợp Tác, Community): nút tròn chỉ có biểu tượng, nhãn hiện khi di chuột /
// tập trung bàn phím (tooltip). Module truyền nhãn + hành động; kích cỡ, vị trí, màu do component này quyết định.

import { UnreadBadge } from "@ai/messages-web/components/UnreadBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function AssistantFab({
  icon,
  label,
  tooltip,
  onClick,
  badge = 0,
  className,
}: {
  icon: ReactNode;
  /** Nhãn đọc màn hình (aria-label). */
  label: string;
  /** Nhãn hiện khi di chuột, vd "Hỏi trợ lý AI". */
  tooltip: string;
  onClick: () => void;
  /** CR-132: số tin nhắn chưa đọc (0 ⇒ không hiện; trên 99 ⇒ 99+). */
  badge?: number;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="assistant-fab"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "group fixed right-5 bottom-20 z-30 grid h-12 w-12 place-items-center rounded-full bg-act text-on-act shadow-toast transition-transform hover:scale-105 active:scale-95 md:right-6 md:bottom-6",
            className,
          )}
        >
          {icon}
          <UnreadBadge count={badge} className="absolute -top-1 -right-1" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

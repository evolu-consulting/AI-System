// CR-121 C-6 · nút nổi trợ lý AI DUY NHẤT của mọi module (Sổ Hợp Tác, Community): nút tròn chỉ có biểu tượng, nhãn hiện khi di chuột /
// tập trung bàn phím (tooltip). Module truyền nhãn + hành động; kích cỡ, vị trí, màu do component này quyết định.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function AssistantFab({
  icon,
  label,
  tooltip,
  onClick,
  className,
}: {
  icon: ReactNode;
  /** Nhãn đọc màn hình (aria-label). */
  label: string;
  /** Nhãn hiện khi di chuột, vd "Hỏi trợ lý AI". */
  tooltip: string;
  onClick: () => void;
  className?: string;
}) {
  return (
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
      <span
        role="tooltip"
        className="pointer-events-none absolute right-full mr-2 rounded-md bg-ink px-2 py-1 text-micro whitespace-nowrap text-panel opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {tooltip}
      </span>
    </button>
  );
}

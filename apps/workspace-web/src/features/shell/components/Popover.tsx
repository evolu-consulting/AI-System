// PK-FR-10 · TF5 · menu nhỏ (menu tài khoản). CR-177 W1: bên trong là Popover của kit — Esc đóng và trả focus nút,
// mở ⇒ con trỏ vào trong, bấm ra ngoài đóng. Với `role=menu`: ↑/↓/Home/End đi giữa các mục `menuitem`.
import { Popover as KitPopover, PopoverContent, PopoverTrigger } from "@ai/web-kit/ui/kit/popover";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { radioStep } from "~/components/shared/seg-button";
import { cn } from "~/lib/utils";

/** Mục cần focus khi bấm `key` ở mục `at` (-1 = con trỏ chưa ở mục nào) trong menu `n` mục. */
export function menuStep(key: string, at: number, n: number): number | null {
  if (at < 0) {
    if (key === "ArrowDown" || key === "Home") return n > 0 ? 0 : null;
    if (key === "ArrowUp" || key === "End") return n > 0 ? n - 1 : null;
    return null;
  }
  return radioStep(key === "ArrowRight" || key === "ArrowLeft" ? "" : key, at, n);
}

/** ↑/↓/Home/End giữa các mục `[role=menuitem]` còn bấm được trong menu. */
function onMenuKey(e: KeyboardEvent<HTMLElement>) {
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    ),
  ];
  const to = menuStep(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
  if (to === null) return;
  e.preventDefault();
  items[to]?.focus();
}

export function Popover({
  label,
  role,
  button,
  children,
  up = false,
  full = false,
  onToggle,
}: {
  label: string;
  /** `menu`: danh sách mục (menuitem); `dialog`: nội dung tự do. */
  role: "menu" | "dialog";
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  /** Mở lên trên, sang phải nút (menu tài khoản ở chân sidebar). */
  up?: boolean;
  full?: boolean;
  /** Gọi sau khi mở/đóng (N3: mở chuông ⇒ làm tươi danh sách). */
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const change = (o: boolean) => {
    setOpen(o);
    onToggle?.(o);
  };
  return (
    <div className={cn("relative", full && "w-full")}>
      <KitPopover open={open} onOpenChange={change}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-haspopup={role}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-lg px-2 text-left text-ink-2 hover:bg-sunk",
              full && "w-full",
              open && "bg-sunk",
            )}
          >
            {button}
          </button>
        </PopoverTrigger>
        <PopoverContent
          role={role}
          aria-label={label}
          side={up ? "right" : "bottom"}
          align={up ? "end" : "end"}
          sideOffset={up ? 8 : 4}
          collisionPadding={12}
          onKeyDown={role === "menu" ? onMenuKey : undefined}
          className="w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border-rule bg-panel p-0 shadow-dialog"
        >
          {children(() => change(false))}
        </PopoverContent>
      </KitPopover>
    </div>
  );
}

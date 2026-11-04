// PK-FR-10 · TF5 · menu nhỏ: đóng khi bấm ra ngoài hoặc Escape (Escape trả focus về nút). Nguồn: mgmt-app TopBar.tsx Popover.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

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
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className={cn("relative", full && "w-full")}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup={role}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-lg px-2 text-left text-ink-2 hover:bg-sunk",
          full && "w-full",
          open && "bg-sunk",
        )}
      >
        {button}
      </button>
      {open && (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role là menu/dialog, đều nhận aria-label
        <div
          role={role}
          aria-label={label}
          className={cn(
            "absolute z-50 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-rule bg-panel shadow-dialog",
            up ? "bottom-0 left-full ml-2" : "top-12 right-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

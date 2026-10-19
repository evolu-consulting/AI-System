// PK-FR-10 · TF6 · bảng nhỏ dưới nút hình viên thuốc; đóng khi bấm ra ngoài hoặc Esc. Nguồn: table.tsx:180-210.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

export const PILL =
  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-label whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
export const PILL_OFF = "border-rule bg-panel text-ink-2 hover:border-ink-2/30 hover:bg-sunk";
export const PILL_ON = "border-act/40 bg-act-soft font-medium text-act";

export function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="opacity-60">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function Pop({
  button,
  children,
  align = "left",
  startOpen = false,
}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(open, () => setOpen(!open))}
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1.5 w-64 rounded-xl border border-rule bg-panel p-1.5 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

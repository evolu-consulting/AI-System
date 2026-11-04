// ux-excel E1/E4: menu nhỏ dạng nút + danh sách (Xuất ▾, ⋯). Đóng khi bấm ra ngoài / Esc / chọn một mục. Chỉ trình bày.
import { type ReactNode, useEffect, useRef, useState } from "react";

export type PopItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Thuộc tính `data-approval` để harness ẩn/nhận (giữ như nút cũ). */
  dataAttr?: string;
};

export function PopMenu({
  trigger,
  ariaLabel,
  triggerClass,
  items,
  disabled,
  busy,
}: {
  trigger: ReactNode;
  ariaLabel: string;
  triggerClass: string;
  items: PopItem[];
  disabled?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={root} className="relative inline-block">
      <button
        type="button"
        className={triggerClass}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[160px] rounded-lg border border-rule bg-panel py-1 text-sm shadow-lg"
        >
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              role="menuitem"
              data-approval={i.dataAttr}
              disabled={i.disabled}
              className="block w-full px-3 py-2 text-left hover:bg-sunk disabled:text-dim"
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

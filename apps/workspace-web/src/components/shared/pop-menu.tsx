// ux-excel E1/E4: menu nhỏ dạng nút + danh sách (Xuất ▾, ⋯). Đóng khi bấm ra ngoài / Esc / chọn một mục. Chỉ trình bày.
import { type ReactNode, useEffect, useRef, useState } from "react";

export type PopItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Thuộc tính `data-approval` để harness ẩn/nhận (giữ như nút cũ). */
  dataAttr?: string;
  /** CR-128 (e): `data-testid` của mục. */
  testId?: string;
  /** Mục nguy hiểm (Xoá): chữ đỏ, có vạch ngăn phía trên. */
  danger?: boolean;
  /** Vạch ngăn phía trên mục. */
  divider?: boolean;
  /** Lý do khi mục bị khoá (dòng phụ + tooltip). */
  why?: string;
};

export function PopMenu({
  trigger,
  ariaLabel,
  triggerClass,
  items,
  disabled,
  busy,
  triggerTestId,
}: {
  trigger: ReactNode;
  ariaLabel: string;
  triggerClass: string;
  items: PopItem[];
  disabled?: boolean;
  busy?: boolean;
  triggerTestId?: string;
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
        data-testid={triggerTestId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[200px] rounded-lg border border-rule bg-panel py-1 text-sm shadow-lg"
        >
          {items.map((i) => (
            <div key={i.key} role="none">
              {(i.divider || i.danger) && <hr className="my-1 border-rule" />}
              <button
                type="button"
                role="menuitem"
                data-approval={i.dataAttr}
                data-testid={i.testId}
                disabled={i.disabled}
                title={i.why}
                className={`block w-full px-3 py-2 text-left hover:bg-sunk disabled:text-dim ${
                  i.danger ? "text-late" : ""
                }`}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
              >
                {i.label}
                {i.why && <span className="block text-caption text-dim">{i.why}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

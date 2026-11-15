// ux-excel E1/E4: menu nhỏ dạng nút + danh sách (Xuất ▾, ⋯). Đóng khi bấm ra ngoài / Esc / chọn một mục. Chỉ trình bày.
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/** Vạch ngăn phía trên mục thứ `idx`: chỉ khi mục đòi vạch (divider/danger) VÀ đã có mục phía trước (mục đầu không có vạch). */
export function showDivider(items: Pick<PopItem, "divider" | "danger">[], idx: number): boolean {
  const i = items[idx];
  return idx > 0 && !!i && !!(i.divider || i.danger);
}

export type MenuPos = { top?: number; bottom?: number; right: number; maxHeight: number };

/** CR-166: vị trí menu `fixed` theo nút (không bị khung cha có overflow cắt). Đủ chỗ phía dưới ⇒ mở xuống; không thì lật lên nếu phía trên rộng hơn. */
export function menuPosition(
  r: { top: number; bottom: number; right: number },
  menuH: number,
  vw: number,
  vh: number,
  gap = 4,
  edge = 8,
): MenuPos {
  const below = vh - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  const right = Math.max(edge, vw - r.right);
  if (menuH <= below || below >= above)
    return { top: r.bottom + gap, right, maxHeight: Math.max(below, 80) };
  return { bottom: vh - r.top + gap, right, maxHeight: Math.max(above, 80) };
}

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
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const place = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setPos(menuPosition(r, menu.current?.offsetHeight ?? 0, window.innerWidth, window.innerHeight));
  }, []);
  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={btn}
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
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", ...(pos ?? { top: 0, right: 0, visibility: "hidden" }) }}
            className="z-50 min-w-[200px] overflow-y-auto rounded-lg border border-rule bg-panel py-1 text-sm shadow-lg"
          >
            {items.map((i, idx) => (
              <div key={i.key} role="none">
                {showDivider(items, idx) && <hr className="my-1 border-rule" />}
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
          </div>,
          document.body,
        )}
    </div>
  );
}

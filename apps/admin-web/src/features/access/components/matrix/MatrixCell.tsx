// ADM-FR-35 · M3-R09 · ô tick của ma trận: `button role=checkbox` (aria-checked, aria-disabled khi khoá), chấm tím khi chưa lưu.
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
// `memo` với props nguyên thuỷ (D: tránh dựng lại cả lưới); tooltip dùng MỘT phần tử chung ở GrantMatrix (không nhân bản chữ trong DOM).
import { Check, Minus } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

export type TipState = { text: string; x: number; y: number };

type Props = {
  r: number;
  c: number;
  label: string;
  checked: boolean;
  /** `true` → aria-checked="mixed" (chỉ dùng cho ô tiêu đề hàng/cột). */
  mixed?: boolean;
  locked: boolean;
  dirty: boolean;
  tabbable: boolean;
  tip: string;
  onToggle: (r: number, c: number) => void;
  onTip: (tip: TipState | null) => void;
};

function showTip(tip: string, el: HTMLElement, onTip: Props["onTip"]) {
  const box = el.getBoundingClientRect();
  onTip({ text: tip, x: box.left + box.width / 2, y: box.bottom + 6 });
}

function MatrixCellImpl(p: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={p.mixed ? "mixed" : p.checked}
      aria-disabled={p.locked || undefined}
      aria-label={p.label}
      data-r={p.r}
      data-c={p.c}
      tabIndex={p.tabbable ? 0 : -1}
      onClick={() => !p.locked && p.onToggle(p.r, p.c)}
      onPointerEnter={(e) => showTip(p.tip, e.currentTarget, p.onTip)}
      onPointerLeave={() => p.onTip(null)}
      onFocus={(e) => showTip(p.tip, e.currentTarget, p.onTip)}
      onBlur={() => p.onTip(null)}
      className={cn(
        "relative mx-auto flex size-6 items-center justify-center rounded border border-input bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        p.checked && "border-primary bg-primary text-primary-foreground",
        p.locked && "cursor-not-allowed opacity-60",
      )}
    >
      {p.checked ? <Check aria-hidden className="size-4" /> : null}
      {p.mixed ? <Minus aria-hidden className="size-4" /> : null}
      {p.dirty ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </button>
  );
}

export const MatrixCell = memo(MatrixCellImpl);

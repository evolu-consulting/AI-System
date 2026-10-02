// ADM-FR-35 · M3-R09 · ô tick cả hàng/cả cột (tri-state: checked | mixed | unchecked); tên truy cập do nơi gọi đặt.
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LineState } from "../../lib/matrix";

type Props = { label: string; state: LineState; onToggle: () => void };

export function LineCheckbox({ label, state, onToggle }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state === "checked"}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border border-input bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        state !== "unchecked" && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === "checked" ? <Check aria-hidden className="size-3.5" /> : null}
      {state === "mixed" ? <Minus aria-hidden className="size-3.5" /> : null}
    </button>
  );
}

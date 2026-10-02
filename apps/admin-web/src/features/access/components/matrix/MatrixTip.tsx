// ADM-FR-35 · tooltip dùng chung của lưới ma trận: MỘT phần tử `role=tooltip` (không nhân bản chữ như Tooltip Radix).
import type { TipState } from "./MatrixCell";

export function MatrixTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-caption text-background shadow"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}

// ADM-FR-71 · P-b2 (plan-frontend §1): tiêu đề cột "Bước n" + nút "＋ Thêm giai đoạn vào bước n" (aria-disabled khi đủ 3).
// Cột đầy bị rê vào khi kéo ⇒ viền destructive + biểu tượng khoá (không chỉ màu).
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { Lock, Plus } from "lucide-react";
import { memo } from "react";
import { useFlowHost } from "../context";
import { HEADER_NODE_H, NODE_W } from "../layout/columns";
import { HiddenHandle } from "./HiddenHandle";

/** `label` (quy trình khe): số bước duyệt hiển thị, `null` = cột nút hệ thống (không số, không nút thêm); vắng = đếm cũ. */
export type StepHeaderData = {
  step: number;
  full: boolean;
  label?: number | null;
};
export type StepHeaderType = Node<StepHeaderData, "stepHeader">;

function StepHeaderImpl({ data }: NodeProps<StepHeaderType>) {
  const { labels, mode, onAddToStep, blockedStep } = useFlowHost();
  const blocked = blockedStep === data.step;
  const slotMode = data.label !== undefined;
  const n = data.label ?? data.step + 1;
  return (
    <div
      style={{ width: NODE_W, height: HEADER_NODE_H }}
      className={`pointer-events-auto flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${
        blocked ? "border-destructive bg-card" : "border-transparent bg-muted"
      }`}
    >
      <HiddenHandle id="back-in" type="target" position={Position.Bottom} />
      <HiddenHandle type="target" position={Position.Left} />
      <h3 className="flex items-center gap-1 text-label font-medium">
        {blocked ? <Lock aria-hidden className="size-3.5 text-destructive" /> : null}
        {data.label === null ? null : labels.stepTitle(n)}
      </h3>
      {mode !== "edit" || slotMode || !onAddToStep ? null : (
        <button
          type="button"
          aria-label={labels.addToStep(n)}
          aria-disabled={data.full || undefined}
          title={labels.addToStep(n)}
          className={`nodrag inline-flex size-6 items-center justify-center rounded-md border border-border bg-card hover:bg-accent ${
            data.full ? "opacity-50" : ""
          }`}
          onClick={() => onAddToStep(data.step)}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

export const StepHeaderNode = memo(StepHeaderImpl);

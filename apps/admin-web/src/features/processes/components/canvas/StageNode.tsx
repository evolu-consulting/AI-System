// ADM-FR-71 · P-b2 (plan-frontend §1, FB9): node giai đoạn trên canvas — một `button` "Giai đoạn n: <tên>" (tabIndex thủ công),
// phím Alt+mũi tên/Delete như StepList; kéo thả do xyflow (`onNodeDragStop` ở ProcessCanvas).
// dlc-step-library: bước DLC CÓ CỔNG (bất kỳ khoá/việc nào) có cổng ra "Từ chối" HIỆN ở đáy node — kéo thả lên bước đứng trước
// để đặt chỗ quay lại (ProcessCanvas `linkable`); cạnh "Từ chối" vào node qua `back-in` ở đáy.

import { HiddenHandle } from "@ai/flow-canvas";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useFlowCtx } from "../flow/flow-ctx";
import { useHandlers } from "./canvas-ctx";
import { FINISH_CLASS, FlowNodeBody, isFinishView } from "./FlowNodeBody";
import { StageBody, stageButtonClass } from "./StageBody";
import { onStageKeyDown } from "./stage-keys";
import { type StageView, sameView } from "./stage-view";

export type StageNodeData = { v: StageView; selected: boolean; readOnly: boolean };
export type StageNodeType = Node<StageNodeData, "stage">;

/** Cổng ra "Từ chối" (id `back` = nguồn cạnh quay lại): nhãn chữ, nét warning như cạnh quay lại (không chỉ màu). */
function RejectPort() {
  const { t } = useTranslation();
  const label = t("process.admin.library.dlc.reject");
  return (
    <Handle
      id="back"
      type="source"
      position={Position.Bottom}
      title={t("process.admin.library.dlc.rejectHint")}
      aria-label={label}
      style={{ left: "70%", width: "auto", height: "auto", background: "var(--color-warning-bg)" }}
      className="rounded-full border border-warning px-1.5 text-caption leading-4 text-warning"
    >
      <span className="pointer-events-none">{label}</span>
    </Handle>
  );
}

function StageNodeImpl({ data }: NodeProps<StageNodeType>) {
  const h = useHandlers();
  const { v, selected } = data;
  const flow = useFlowCtx();
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className="pointer-events-auto">
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle type="source" position={Position.Right} />
      <HiddenHandle id="back-in" type="target" position={Position.Bottom} />
      {v.dlc?.gate ? (
        <RejectPort />
      ) : (
        <HiddenHandle id="back" type="source" position={Position.Top} />
      )}
      <HiddenHandle id="branch" type="source" position={Position.Bottom} />
      <button
        type="button"
        data-stage-uid={v.uid}
        aria-current={selected ? "true" : undefined}
        className={`${stageButtonClass(v, selected)} h-full overflow-hidden ${flow && isFinishView(v) ? FINISH_CLASS : ""}`}
        onClick={(e) => h.onSelect(v.uid, e.detail === 0)}
        onKeyDown={(e) =>
          onStageKeyDown(e, {
            uid: v.uid,
            index: v.index,
            step: v.step,
            readOnly: h.readOnly,
            locked: v.locked,
            ops: h.ops,
            onRemove: h.onRemove,
          })
        }
      >
        {flow ? <FlowNodeBody v={v} /> : <StageBody v={v} />}
      </button>
    </div>
  );
}

export const StageNode = memo(
  StageNodeImpl,
  (a, b) =>
    sameView(a.data.v, b.data.v) &&
    a.data.selected === b.data.selected &&
    a.data.readOnly === b.data.readOnly,
);

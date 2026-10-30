// ADM-FR-71 · P-b2 (plan-frontend §1, FB9): node giai đoạn trên canvas — một `button` "Giai đoạn n: <tên>" (tabIndex thủ công),
// phím Alt+mũi tên/Delete như StepList; kéo thả do xyflow (`onNodeDragStop` ở ProcessCanvas).
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_H, NODE_W } from "../../lib/canvas-layout";
import { useHandlers } from "./canvas-ctx";
import { HiddenHandle } from "./HiddenHandle";
import { StageBody, stageButtonClass } from "./StageBody";
import { onStageKeyDown } from "./stage-keys";
import { type StageView, sameView } from "./stage-view";

export type StageNodeData = { v: StageView; selected: boolean; readOnly: boolean };
export type StageNodeType = Node<StageNodeData, "stage">;

function StageNodeImpl({ data }: NodeProps<StageNodeType>) {
  const h = useHandlers();
  const { v, selected } = data;
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className="pointer-events-auto">
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle type="source" position={Position.Right} />
      <HiddenHandle id="back" type="source" position={Position.Top} />
      <HiddenHandle id="branch" type="source" position={Position.Bottom} />
      <button
        type="button"
        data-stage-uid={v.uid}
        aria-current={selected ? "true" : undefined}
        className={`${stageButtonClass(v, selected)} h-full overflow-hidden`}
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
        <StageBody v={v} />
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

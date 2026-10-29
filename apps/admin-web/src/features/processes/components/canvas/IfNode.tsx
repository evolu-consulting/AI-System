// CR-103 · fnr-if (flow-node-registry design §3): node If trên canvas — hình thoi, cổng ra "Đúng" / "Sai" tới bước đích (cạnh dùng
// lại `BranchEdge`; handle id `yes` / `no`, cạnh tiến thường ra bên phải). Chọn / phím như `StageNode` (một `button` "Giai đoạn n: <tên>").
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { NODE_H, NODE_W } from "../../lib/canvas-layout";
import { useHandlers } from "./canvas-ctx";
import { HiddenHandle } from "./HiddenHandle";
import { onStageKeyDown } from "./stage-keys";
import { type StageView, sameView } from "./stage-view";

export type IfData = { v: StageView; selected: boolean; readOnly: boolean };
export type IfType = Node<IfData, "if">;

function IfImpl({ data }: NodeProps<IfType>) {
  const { t } = useTranslation();
  const h = useHandlers();
  const { v, selected } = data;
  const name = v.name || t("process.admin.editor.stage.unnamed");
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className="pointer-events-auto relative">
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle id="back" type="source" position={Position.Top} />
      <HiddenHandle id="yes" type="source" position={Position.Right} />
      {/* fnr-canvas: cả Đúng và Sai ra ở mũi phải (kiểu n8n) — cạnh smoothstep rẽ lên/xuống, không vòng dưới node. */}
      <HiddenHandle id="no" type="source" position={Position.Right} />
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
      >
        <polygon
          points="50,2 98,50 50,98 2,50"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className={selected ? "fill-accent stroke-primary" : "fill-card stroke-border"}
        />
      </svg>
      <button
        type="button"
        data-stage-uid={v.uid}
        data-testid="if-node"
        aria-current={selected ? "true" : undefined}
        className="absolute inset-0 flex items-center justify-center px-14 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => h.onSelect(v.uid, e.detail === 0)}
        onKeyDown={(e) =>
          onStageKeyDown(e, {
            uid: v.uid,
            index: v.index,
            step: v.step,
            readOnly: h.readOnly,
            ops: h.ops,
            onRemove: h.onRemove,
          })
        }
      >
        <span
          className="inline-block w-full break-words text-caption font-medium leading-tight"
          title={name}
        >
          {t("process.admin.editor.stage.aria", { n: v.index + 1, name })}
        </span>
      </button>
    </div>
  );
}

export const IfNode = memo(
  IfImpl,
  (a, b) =>
    sameView(a.data.v, b.data.v) &&
    a.data.selected === b.data.selected &&
    a.data.readOnly === b.data.readOnly,
);

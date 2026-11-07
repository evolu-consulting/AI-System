// CR-103 · fnr-if (flow-node-registry design §3): node If trên canvas — hình thoi, cổng ra "Đúng" / "Sai" tới bước đích (cạnh dùng
// lại `BranchEdge`; handle id `yes` / `no`, cạnh tiến thường ra bên phải). Chọn / phím như `StageNode` (một `button` "Giai đoạn n: <tên>").

import { HiddenHandle } from "@ai/flow-canvas";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useFlowCtx } from "../flow/flow-ctx";
import { useHandlers } from "./canvas-ctx";
import { CONNECT_TARGET } from "./connect-target";
import { IfPort } from "./OutPort";
import { onStageKeyDown } from "./stage-keys";
import { type StageView, sameView } from "./stage-view";

export type IfData = {
  v: StageView;
  selected: boolean;
  readOnly: boolean;
  /** CR-122 · p22 · hiện cổng Đúng / Sai để kéo nối tay. */
  connectable?: boolean;
};
export type IfType = Node<IfData, "if">;

function IfImpl({ data }: NodeProps<IfType>) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const h = useHandlers();
  const { v, selected } = data;
  const name = v.name || t("process.admin.editor.stage.unnamed");
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={`pointer-events-auto relative ${CONNECT_TARGET}`}
    >
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle id="back" type="source" position={Position.Top} />
      {/* fnr-canvas: cả Đúng và Sai ra ở mép phải (kiểu n8n) — cạnh smoothstep rẽ lên/xuống, không vòng dưới node.
          p22: sơ đồ sửa được ⇒ hai cổng có nhãn Đúng / Sai, kéo sang node đích để đặt "Đúng/Sai thì tới bước". */}
      <IfPort id="yes" connectable={data.connectable === true} />
      <IfPort id="no" connectable={data.connectable === true} />
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
        onClick={(e) => {
          // Shift/Ctrl/Cmd + nhấn = chọn nhiều trên canvas, không đổi bước đang mở ở ngăn chi tiết
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) h.onSelect(v.uid, e.detail === 0);
        }}
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
          {flow ? name : t("process.admin.editor.stage.aria", { n: v.index + 1, name })}
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
    a.data.readOnly === b.data.readOnly &&
    a.data.connectable === b.data.connectable,
);

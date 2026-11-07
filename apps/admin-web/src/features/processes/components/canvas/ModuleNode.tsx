// CR-123 · FLOW3-FR-14 · node của app (Ký số = gửi + chờ) là MỘT ô trên sơ đồ, cùng dáng `StageNode`: tên bước + loại node + tóm tắt,
// bên phải là các đầu ra theo kết quả nghiệp vụ (Ký xong · Từ chối · Hết hạn). Chọn ô = chọn stage ĐẦU của cụm (panel gộp do u3a).
// Đầu ra chỉ để đọc sơ đồ (không kéo nối tay ở đây); cạnh từ đầu ra "đi tiếp" là cạnh tiến thường (handle đầu tiên trong DOM).
import { HiddenHandle } from "@ai/flow-canvas";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { exitHandle } from "../../lib/canvas-connect";
import { useHandlers } from "./canvas-ctx";
import { FlowNodeBody } from "./FlowNodeBody";
import { stageButtonClass } from "./StageBody";
import type { StageNodeType } from "./StageNode";
import { onStageKeyDown } from "./stage-keys";
import type { ModuleExit, StageView } from "./stage-view";

function ExitPort({ x, top }: { x: ModuleExit; top: string }) {
  const { t } = useTranslation();
  const label = x.label || t("process.admin.canvas.module.done");
  return (
    <Handle
      id={exitHandle(x.key, x.on)}
      type="source"
      position={Position.Right}
      isConnectable={false}
      title={t("process.admin.canvas.module.exitHint", { label })}
      aria-label={label}
      data-testid={`module-exit-${x.key}`}
      style={{
        top,
        width: "auto",
        height: "auto",
        background: "var(--color-card)",
        zIndex: 2,
      }}
      className={`rounded-full border px-1.5 text-caption leading-4 ${
        x.main ? "border-success text-success" : "border-warning text-warning"
      }`}
    >
      <span className="pointer-events-none">{label}</span>
    </Handle>
  );
}

export const exitTop = (i: number, n: number): string =>
  `${Math.round(((i + 1) / (n + 1)) * 100)}%`;

export function ModuleNode({ data }: NodeProps<StageNodeType>) {
  const h = useHandlers();
  const { v, selected } = data;
  const exits = v.module?.exits ?? [];
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className="pointer-events-auto"
      data-testid="module-node"
    >
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle id="back-in" type="target" position={Position.Bottom} />
      <HiddenHandle id="back" type="source" position={Position.Top} />
      {exits.map((x, i) => (
        <ExitPort key={x.key} x={x} top={exitTop(i, exits.length)} />
      ))}
      <button
        type="button"
        data-stage-uid={v.uid}
        aria-current={selected ? "true" : undefined}
        className={`${stageButtonClass(v, selected)} h-full overflow-hidden`}
        onClick={(e) => h.onSelect(v.uid, e.detail === 0)}
        onKeyDown={(e) => onKey(e, v, h)}
      >
        <FlowNodeBody v={v} />
      </button>
    </div>
  );
}

function onKey(
  e: Parameters<typeof onStageKeyDown>[0],
  v: StageView,
  h: ReturnType<typeof useHandlers>,
) {
  onStageKeyDown(e, {
    uid: v.uid,
    index: v.index,
    step: v.step,
    readOnly: h.readOnly,
    locked: v.locked,
    ops: h.ops,
    onRemove: h.onRemove,
  });
}

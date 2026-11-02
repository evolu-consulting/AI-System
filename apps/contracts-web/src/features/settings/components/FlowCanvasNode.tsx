// CR-106 · node của canvas quy trình duyệt (chỉ đọc): Bắt đầu / Bước duyệt / Ghi Đã duyệt (khoá hệ thống).
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Flag, Lock, Play } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { type FlowCanvasNode, SKIP_IN, SKIP_OUT, type StepBadge } from "../lib/flow-canvas";
import { StepInfoLines } from "./StepInfoLines";

// Tay nắm chỉ để xyflow nối cạnh: ẩn, không bắt chuột.
const HANDLE = "!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0";

/** `skipIn`/`skipOut` = tay nắm bên phải cho nhánh bỏ qua (CR-108); tay nắm mặc định (trên/dưới) đứng TRƯỚC để cạnh chính dùng nó. */
function Edges({
  top,
  bottom,
  skipIn = false,
  skipOut = false,
}: {
  top: boolean;
  bottom: boolean;
  skipIn?: boolean;
  skipOut?: boolean;
}) {
  return (
    <>
      {top && (
        <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      )}
      {bottom && (
        <Handle type="source" position={Position.Bottom} isConnectable={false} className={HANDLE} />
      )}
      {skipOut && (
        <Handle
          id={SKIP_OUT}
          type="source"
          position={Position.Right}
          isConnectable={false}
          className={HANDLE}
        />
      )}
      {skipIn && (
        <Handle
          id={SKIP_IN}
          type="target"
          position={Position.Right}
          isConnectable={false}
          className={HANDLE}
        />
      )}
    </>
  );
}

function Pill({ kind }: { kind: StepBadge }) {
  const { t } = useTranslation();
  const label =
    kind === "conditional"
      ? t("contracts.flow.current.conditional")
      : kind === "esign"
        ? t("contracts.flow.current.esign")
        : "Dify";
  return (
    <span className="rounded-full bg-act-soft px-2 py-0.5 text-caption font-semibold text-act">
      {label}
    </span>
  );
}

function StartImpl({ width, height }: NodeProps<FlowCanvasNode>) {
  const { t } = useTranslation();
  return (
    <div
      style={{ width, height }}
      className="flex items-center justify-center gap-2 rounded-full border border-rule bg-sunk text-label font-medium"
    >
      <Edges top={false} bottom skipOut />
      <Play aria-hidden className="size-3.5 text-dim" />
      {t("contracts.flow.current.canvas.start")}
    </div>
  );
}

function FinalizeImpl({ width, height }: NodeProps<FlowCanvasNode>) {
  const { t } = useTranslation();
  return (
    <div
      style={{ width, height }}
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-field bg-sunk px-3 text-label font-medium"
    >
      <Edges top bottom={false} skipIn />
      <Flag aria-hidden className="size-4 text-dim" />
      <span>{t("contracts.flow.current.canvas.finalize")}</span>
      <Lock aria-hidden className="size-3.5 text-dim" />
      <span className="sr-only">{t("contracts.flow.current.canvas.locked")}</span>
    </div>
  );
}

function StepImpl({ data, width, height }: NodeProps<FlowCanvasNode>) {
  return (
    <div
      style={{ width, height }}
      data-run={data.dim ? "false" : "true"}
      className={`flex flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-panel px-3 py-2 ${
        data.dim ? "border-dashed border-rule opacity-40" : "border-rule shadow-sm"
      }`}
    >
      <Edges top bottom skipIn skipOut />
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunk text-caption text-dim">
          {data.index}
        </span>
        <span className="truncate font-medium" title={data.title}>
          {data.title}
        </span>
      </div>
      {data.department && <span className="truncate text-caption text-dim">{data.department}</span>}
      {data.badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.badges.map((b) => (
            <Pill key={b} kind={b} />
          ))}
        </div>
      )}
      <StepInfoLines info={data.info} />
    </div>
  );
}

export const FLOW_NODE_TYPES = {
  start: memo(StartImpl),
  step: memo(StepImpl),
  finalize: memo(FinalizeImpl),
};

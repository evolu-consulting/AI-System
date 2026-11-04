// CR-106 · node của sơ đồ duyệt dọc (chỉ đọc): Bắt đầu / Bước duyệt / Ghi Đã duyệt (khoá hệ thống). Chữ + lớp CSS lấy từ host.
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Flag, Lock, Play } from "lucide-react";
import { memo } from "react";
import { useFlowHost } from "../context";
import { type FlowCanvasNode, SKIP_IN, SKIP_OUT, type StepBadge } from "../layout/vertical";

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
  const { labels, theme } = useFlowHost();
  const label =
    kind === "conditional" ? labels.conditional : kind === "esign" ? labels.esign : labels.dify;
  return <span className={theme.pill}>{label}</span>;
}

function StartImpl({ width, height }: NodeProps<FlowCanvasNode>) {
  const { labels, theme } = useFlowHost();
  return (
    <div style={{ width, height }} className={theme.start}>
      <Edges top={false} bottom skipOut />
      <Play aria-hidden className={theme.startIcon} />
      {labels.start}
    </div>
  );
}

function FinalizeImpl({ width, height }: NodeProps<FlowCanvasNode>) {
  const { labels, theme } = useFlowHost();
  return (
    <div style={{ width, height }} className={theme.finalize}>
      <Edges top bottom={false} skipIn />
      <Flag aria-hidden className={theme.finalizeIcon} />
      <span>{labels.finalize}</span>
      <Lock aria-hidden className={theme.lockIcon} />
      <span className="sr-only">{labels.locked}</span>
    </div>
  );
}

function StepImpl({ data, width, height }: NodeProps<FlowCanvasNode>) {
  const { theme, renderInfo } = useFlowHost();
  return (
    <div
      style={{ width, height }}
      data-run={data.dim ? "false" : "true"}
      className={`${theme.step} ${data.dim ? theme.stepOff : theme.stepOn}`}
    >
      <Edges top bottom skipIn skipOut />
      <div className="flex items-center gap-2">
        <span className={theme.stepIndex}>{data.index}</span>
        <span className="truncate font-medium" title={data.title}>
          {data.title}
        </span>
      </div>
      {data.department && <span className={theme.stepDept}>{data.department}</span>}
      {data.badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.badges.map((b) => (
            <Pill key={b} kind={b} />
          ))}
        </div>
      )}
      {renderInfo?.(data.info)}
    </div>
  );
}

export const VERTICAL_NODE_TYPES = {
  start: memo(StartImpl),
  step: memo(StepImpl),
  finalize: memo(FinalizeImpl),
};

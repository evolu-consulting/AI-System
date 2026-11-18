// CR-184 · node của sơ đồ CHỈ XEM của quy trình đang chạy (Sổ Hợp Tác): Bắt đầu / Bước / Nếu (hình thoi, cổng Đúng + Sai) / Kết thúc.
// Hướng Dọc (cổng ra ở đáy). Chữ + lớp CSS lấy từ host (`useFlowHost`); tay nắm ẩn, không nối tay.
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Flag, Play } from "lucide-react";
import { memo } from "react";
import { useFlowHost } from "../context";
import type { DefNodeData } from "../layout/def-graph";
import { NODE_H, NODE_W } from "../layout/geometry";
import { HiddenHandle } from "./HiddenHandle";

const SIZE = { width: NODE_W, height: NODE_H } as const;
const PORT = { opacity: 0, pointerEvents: "none", width: 1, height: 1 } as const;
type P = NodeProps & { data: DefNodeData };

function TriggerImpl({ data }: P) {
  const { theme } = useFlowHost();
  return (
    <div style={SIZE} className={theme.trigger} data-testid="def-node-trigger">
      <HiddenHandle type="source" position={Position.Bottom} />
      <span className="flex items-center gap-1.5 font-semibold">
        <Play aria-hidden className={theme.startIcon} />
        {data.title}
      </span>
      {data.sub && <span className="line-clamp-2 text-caption">{data.sub}</span>}
    </div>
  );
}

function StageImpl({ data }: P) {
  const { theme } = useFlowHost();
  return (
    <div style={SIZE} className={`${theme.step} ${theme.stepOn}`} data-testid="def-node-stage">
      <HiddenHandle type="target" position={Position.Top} />
      <HiddenHandle type="source" position={Position.Bottom} />
      <HiddenHandle id="branch" type="source" position={Position.Right} />
      <HiddenHandle id="back-in" type="target" position={Position.Right} />
      <div className="flex items-center gap-2">
        <span className={theme.stepIndex}>{data.index}</span>
        <span className="line-clamp-2 font-medium" title={data.title}>
          {data.title}
        </span>
      </div>
      {data.sub && <span className={theme.stepDept}>{data.sub}</span>}
      {data.badge && (
        <div className="flex flex-wrap gap-1">
          <span className={theme.pill}>{data.badge}</span>
        </div>
      )}
    </div>
  );
}

/** Hình thoi: hai cổng ra Đúng (trái) / Sai (phải) ở đáy, đúng thứ tự cổng ELK. */
function IfImpl({ data }: P) {
  const { theme } = useFlowHost();
  return (
    <div style={SIZE} className="relative" data-testid="def-node-if">
      <HiddenHandle type="target" position={Position.Top} />
      <Handle
        id="yes"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ ...PORT, left: "30%" }}
      />
      <Handle
        id="no"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ ...PORT, left: "70%" }}
      />
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
          className={theme.ifShape}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center px-14 text-center text-caption font-medium leading-tight">
        <span className="line-clamp-3 w-full break-words" title={data.title}>
          {data.title}
        </span>
      </span>
    </div>
  );
}

function EndImpl({ data }: P) {
  const { theme } = useFlowHost();
  return (
    <div style={SIZE} className={theme.finalize} data-testid="def-node-end">
      <HiddenHandle type="target" position={Position.Top} />
      <Flag aria-hidden className={theme.finalizeIcon} />
      <span>{data.title}</span>
    </div>
  );
}

export const DEF_VIEW_NODE_TYPES = {
  defTrigger: memo(TriggerImpl),
  defStage: memo(StageImpl),
  defIf: memo(IfImpl),
  defEnd: memo(EndImpl),
};

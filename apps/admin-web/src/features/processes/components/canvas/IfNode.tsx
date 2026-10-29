// CR-103 · fnr-if (flow-node-registry design §3): node If trên canvas — hình thoi, hai cổng ra "Đúng" / "Sai" tới bước đích
// (cạnh dùng lại `BranchEdge`; handle id `yes` / `no`). Nối vào ProcessCanvas ở đợt wiring.
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { HiddenHandle } from "./HiddenHandle";

export const IF_NODE_SIZE = 96;
export type IfData = { label: string; selected?: boolean };
export type IfType = Node<IfData, "if">;

function IfImpl({ data }: NodeProps<IfType>) {
  const { t } = useTranslation();
  return (
    <div
      style={{ width: IF_NODE_SIZE, height: IF_NODE_SIZE }}
      className="relative flex items-center justify-center"
      data-testid="if-node"
    >
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle type="source" id="yes" position={Position.Right} />
      <HiddenHandle type="source" id="no" position={Position.Bottom} />
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full"
        role="presentation"
      >
        <polygon
          points="50,2 98,50 50,98 2,50"
          className={data.selected ? "fill-accent stroke-primary" : "fill-card stroke-border"}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative max-w-[56px] truncate text-caption font-medium">{data.label}</span>
      <span className="absolute -right-1 top-1/2 -translate-y-6 text-caption text-success">
        {t("process.admin.canvas.if.yes")}
      </span>
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-caption text-muted-foreground">
        {t("process.admin.canvas.if.no")}
      </span>
    </div>
  );
}

export const IfNode = memo(IfImpl);

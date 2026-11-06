// CR-122 · U2c · FLOW2-FR-02: node "Bắt đầu khi" — cột ĐẦU của canvas (x = −1 cột), nối tới mọi bước đầu. Bấm ⇒ mở thẻ sự kiện + điều kiện.
import { HiddenHandle } from "@ai/flow-canvas";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { Play } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useFlowCtx } from "../flow/flow-ctx";

export type TriggerNodeData = { label: string; summary: string };
export type TriggerNodeType = Node<TriggerNodeData, "trigger">;

function TriggerNodeImpl({ data }: NodeProps<TriggerNodeType>) {
  const { t } = useTranslation();
  const open = useFlowCtx()?.trigger?.onOpen;
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className="pointer-events-auto">
      <HiddenHandle type="source" position={Position.Right} />
      <button
        type="button"
        data-testid="flow-trigger-node"
        onClick={open}
        className="flex h-full w-full flex-col justify-center gap-1 overflow-hidden rounded-md border-2 border-primary bg-card px-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 text-caption font-semibold text-primary">
          <Play aria-hidden className="size-3.5" />
          {t("process.admin.flow.trigger")}
        </span>
        <span className="truncate text-label font-medium">{data.label}</span>
        <span className="truncate text-caption text-muted-foreground">
          {data.summary || t("process.admin.flow.always")}
        </span>
      </button>
    </div>
  );
}

export const TriggerNode = memo(TriggerNodeImpl);

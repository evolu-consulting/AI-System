// ADM-FR-71 · P-b2 (plan-frontend FB4): chấm nối "Chờ đủ n/n" giữa cột song song và cột kế (trang trí ⇒ aria-hidden).
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { JOIN_H, JOIN_W } from "../../lib/canvas-layout";
import { HiddenHandle } from "./HiddenHandle";

export type JoinData = { count: number };
export type JoinType = Node<JoinData, "join">;

function JoinImpl({ data }: NodeProps<JoinType>) {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden
      style={{ width: JOIN_W, height: JOIN_H }}
      className="flex items-center justify-center rounded-full border border-border bg-card text-caption text-muted-foreground"
    >
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle type="source" position={Position.Right} />
      {t("process.admin.canvas.join", { n: data.count })}
    </div>
  );
}

export const JoinNode = memo(JoinImpl);

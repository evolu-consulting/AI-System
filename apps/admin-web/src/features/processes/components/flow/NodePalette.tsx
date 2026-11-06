// CR-122 · U1 · FLOW2-FR-15: bảng node của trình sửa — chỉ node app khai (manifest); mỗi nút thêm một node vào cuối flow.
// Node chưa có phần chạy (Duyệt độc lập, Ký số: E2/E3) hiện tắt kèm lý do thay vì ẩn.
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { StageOps } from "../../hooks/use-stage-ops";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { useFlowCtx } from "./flow-ctx";

type Props = { ops: StageOps; count: number; max: number };

/** Có ngữ cảnh flow ⇒ bảng node theo manifest; không ⇒ thanh công cụ giai đoạn thường (children). */
export function FlowToolbar({
  children,
  ...p
}: Props & { children: React.ReactNode }): React.ReactNode {
  return useFlowCtx() ? <NodePalette {...p} /> : children;
}

export function NodePalette({ ops, count, max }: Props) {
  const { t } = useTranslation();
  const ctx = useFlowCtx();
  if (!ctx) return null;
  const full = count >= max;
  const add = (n: NodeEntry) => {
    if (!n.patch) return;
    const patch = n.id === "finish" ? finishPatch(ctx.event) : n.patch;
    ops.addNode(patch, t(`process.admin.flow.node.${n.id}`));
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="flow-palette">
      {nodesForApp(ctx.app).map((n) => (
        <Button
          key={n.id}
          type="button"
          variant="outline"
          size="sm"
          data-testid={`flow-node-${n.id}`}
          disabled={full || !n.patch}
          title={n.patch ? undefined : t("process.admin.flow.node.soon")}
          onClick={() => add(n)}
        >
          {t(`process.admin.flow.node.${n.id}`)}
        </Button>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={ops.arrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
      {full ? (
        <span className="text-caption text-muted-foreground">
          {t("process.admin.canvas.err.stagesMax")}
        </span>
      ) : null}
    </div>
  );
}

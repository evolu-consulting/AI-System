// CR-122 · U2 · FLOW2-FR-15/25: bảng node của trình sửa — node dựng sẵn (Duyệt, Điền thông tin, Nếu, Agent, Công cụ, Ghi giá trị,
// Kết thúc) + node lõi/module lấy từ `GET /process-palette` (Gửi email, Thông báo chuông, Hẹn giờ, Chờ khoảng, Ký số, Hiện bài…).
// Chèn node bảng ghi `stage.node`; mỗi stage mẫu thành một bước mới cuối.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { StageOps } from "../../hooks/use-stage-ops";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { nodeLabel, nodeToPatches } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
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
  const { t, i18n } = useTranslation();
  const ctx = useFlowCtx();
  const palette = usePalette(ctx?.app ?? "", ctx?.tenantId);
  if (!ctx) return null;
  const full = count >= max;
  const add = (n: NodeEntry) => {
    if (!n.patch) return;
    const patch = n.id === "finish" ? finishPatch(ctx.event) : n.patch;
    ops.addNode(patch, t(`process.admin.flow.node.${n.id}`));
  };
  const addModule = (n: AppNodeDecl) =>
    nodeToPatches(n).forEach((patch, i) => {
      const name = nodeLabel(n, i18n.language);
      ops.addNode(patch, i === 0 ? name : `${name} ${i + 1}`);
    });
  const room = max - count;
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
          onClick={() => add(n)}
        >
          {t(`process.admin.flow.node.${n.id}`)}
        </Button>
      ))}
      {(palette.data ?? []).map((n) => (
        <Button
          key={n.key}
          type="button"
          variant="outline"
          size="sm"
          data-testid={`flow-node-${n.key}`}
          disabled={room < n.stages.length}
          onClick={() => addModule(n)}
        >
          {nodeLabel(n, i18n.language)}
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

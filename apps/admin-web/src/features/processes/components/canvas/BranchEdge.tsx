// HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; mockup 04 E1): cạnh rẽ nhánh — từ giai đoạn tới tiêu đề bước đích, nét đứt màu chính
// + nhãn chữ "Rẽ nhánh · luật n" (không chỉ màu; phân biệt với cạnh "Quay lại" màu cảnh báo).
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

function BranchEdgeImpl(p: EdgeProps) {
  const { t } = useTranslation();
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
    curvature: 0.5,
  });
  const d = p.data as { rule?: number; side?: "yes" | "no" } | undefined;
  const rule = d?.rule ?? 1;
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        style={{ stroke: "var(--color-primary)", strokeWidth: 1.5, strokeDasharray: "6 4" }}
      />
      <EdgeLabelRenderer>
        <span
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          className="pointer-events-none absolute rounded bg-accent px-1.5 py-0.5 text-caption text-accent-foreground"
        >
          {d?.side
            ? t(`process.admin.canvas.if.${d.side}`)
            : t("process.admin.canvas.edge.branch", { n: rule })}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

export const BranchEdge = memo(BranchEdgeImpl);

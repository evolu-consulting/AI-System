// ADM-FR-71 · P-b2 (plan-frontend FB4): cạnh quay lại — đường cong phía trên hàng, nét đứt màu warning + nhãn chữ "Quay lại"
// (không chỉ màu).
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

function BackEdgeImpl(p: EdgeProps) {
  const { t } = useTranslation();
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
    curvature: 0.6,
  });
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        style={{ stroke: "var(--color-warning)", strokeWidth: 1.5, strokeDasharray: "6 4" }}
      />
      <EdgeLabelRenderer>
        <span
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          className="pointer-events-none absolute rounded bg-warning-bg px-1.5 py-0.5 text-caption text-warning"
        >
          {t("process.admin.canvas.edge.back")}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

export const BackEdge = memo(BackEdgeImpl);

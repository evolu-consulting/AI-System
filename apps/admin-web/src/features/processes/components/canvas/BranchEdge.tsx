// HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; mockup 04 E1) · CR-103 fnr-canvas: cạnh rẽ nhánh.
// - Luật `after.branch` cũ: từ giai đoạn tới tiêu đề bước đích, nét đứt màu chính + nhãn "Rẽ nhánh · luật n" (bezier).
// - Node If: Đúng = nét liền màu thành công, Sai = nét đứt xám; smoothstep (rẽ vuông, không vòng dưới node) + nhãn viên thuốc
//   (chữ, không chỉ màu).
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
} from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

type Side = "yes" | "no";
const SIDE_STYLE = {
  yes: {
    stroke: "var(--color-success)",
    dash: undefined,
    pill: "border border-success bg-success-bg text-success",
  },
  no: {
    stroke: "var(--color-muted-foreground)",
    dash: "5 4",
    pill: "border border-border bg-muted text-muted-foreground",
  },
} as const;

function BranchEdgeImpl(p: EdgeProps) {
  const { t } = useTranslation();
  const d = p.data as { rule?: number; side?: Side } | undefined;
  const geo = {
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
  };
  const [path, lx, ly] = d?.side
    ? getSmoothStepPath({ ...geo, borderRadius: 14, offset: 16 })
    : getBezierPath({ ...geo, curvature: 0.5 });
  const rule = d?.rule ?? 1;
  const s = d?.side ? SIDE_STYLE[d.side] : null;
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        style={{
          stroke: s?.stroke ?? "var(--color-primary)",
          strokeWidth: 1.75,
          ...(s ? (s.dash ? { strokeDasharray: s.dash } : {}) : { strokeDasharray: "6 4" }),
        }}
      />
      <EdgeLabelRenderer>
        <span
          data-testid={d?.side ? `if-edge-${d.side}` : undefined}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          className={`pointer-events-none absolute rounded-full px-2 py-0.5 text-caption font-medium ${
            s?.pill ?? "rounded bg-accent text-accent-foreground"
          }`}
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

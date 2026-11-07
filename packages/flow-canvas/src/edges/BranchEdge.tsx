// HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; mockup 04 E1) · CR-103 fnr-canvas: cạnh rẽ nhánh.
// - Luật `after.branch` cũ: từ giai đoạn tới tiêu đề bước đích, nét đứt màu chính + nhãn "Rẽ nhánh · luật n" (bezier).
// - Node If: Đúng = nét liền màu thành công, Sai = nét đứt xám; smoothstep (rẽ vuông, không vòng dưới node) + nhãn viên thuốc
//   (chữ, không chỉ màu).
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { useFlowHost } from "../context";
import { InsertSlot, useEdgeHover } from "./InsertSlot";
import { useRoutedPath } from "./use-route";

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
  const { labels } = useFlowHost();
  const d = p.data as { rule?: number; side?: Side } | undefined;
  // CR-125 · x9: đường định tuyến né node; "+" ở GIỮA đường, nhãn Đúng/Sai lệch về phía nguồn để không đè nút.
  const { path, mid, at } = useRoutedPath(p, 14);
  const lab = d?.side ? at(-52) : mid;
  const rule = d?.rule ?? 1;
  const s = d?.side ? SIDE_STYLE[d.side] : null;
  const { hover, on } = useEdgeHover();
  return (
    <>
      <g {...on}>
        <BaseEdge
          id={p.id}
          path={path}
          markerEnd={p.markerEnd}
          interactionWidth={d?.side ? 28 : 20}
          style={{
            stroke: s?.stroke ?? "var(--color-primary)",
            strokeWidth: 1.75,
            ...(s ? (s.dash ? { strokeDasharray: s.dash } : {}) : { strokeDasharray: "6 4" }),
          }}
        />
      </g>
      {d?.side ? (
        <InsertSlot
          p={{ source: p.source, target: p.target, side: d.side, x: mid.x, y: mid.y }}
          hover={hover}
          on={on}
        />
      ) : null}
      {(p.data as { noLabel?: boolean } | undefined)?.noLabel ? null : (
        <EdgeLabelRenderer>
          <span
            data-testid={d?.side ? `if-edge-${d.side}` : undefined}
            style={{ transform: `translate(-50%, -50%) translate(${lab.x}px, ${lab.y}px)` }}
            className={`pointer-events-none absolute rounded-full px-2 py-0.5 text-caption font-medium ${
              s?.pill ?? "rounded bg-accent text-accent-foreground"
            }`}
          >
            {d?.side ? labels[d.side] : labels.edgeBranch(rule)}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const BranchEdge = memo(BranchEdgeImpl);

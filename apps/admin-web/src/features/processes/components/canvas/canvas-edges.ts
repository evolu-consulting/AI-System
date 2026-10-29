// ADM-FR-71 · P-b2 · P-d2 (plan-frontend-d2 §10): cạnh xyflow dẫn xuất từ `LayoutEdge` — tách khỏi `ProcessCanvas` để file không tăng.
import { type Edge, MarkerType } from "@xyflow/react";
import type { Layout } from "../../lib/canvas-layout";

export function toEdge(e: Layout["edges"][number]): Edge {
  const ends = { id: e.id, source: e.source, target: e.target, focusable: false };
  if (e.kind === "back")
    return {
      ...ends,
      type: "back",
      sourceHandle: "back",
      targetHandle: "back-in",
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-warning)" },
    };
  if (e.kind === "branch")
    return {
      ...ends,
      type: "branch",
      sourceHandle: e.side ?? "branch",
      // Cạnh Đúng/Sai của node If tới GIAI ĐOẠN (handle trái mặc định); luật `after.branch` cũ tới tiêu đề bước.
      ...(e.side ? {} : { targetHandle: "back-in" }),
      data: { rule: e.rule, side: e.side },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-primary)" },
    };
  return {
    ...ends,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-muted-foreground)" },
    style: { stroke: "var(--color-muted-foreground)" },
  };
}

// CR-122 · P8: cạnh tiến có nút "+" chèn bước ở giữa (kiểu `forward`; vẫn vẽ nhãn "Duyệt"/"⚠" của host như cạnh mặc định).
import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { InsertSlot, useEdgeHover } from "./InsertSlot";

function ForwardEdgeImpl(p: EdgeProps) {
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
  });
  const { hover, on } = useEdgeHover();
  const hasLabel = p.label !== undefined && p.label !== "";
  return (
    <>
      <g {...on}>
        <BaseEdge
          id={p.id}
          path={path}
          markerEnd={p.markerEnd}
          style={p.style}
          interactionWidth={28}
          label={p.label}
          labelX={lx}
          labelY={ly}
          labelStyle={p.labelStyle}
          labelBgStyle={p.labelBgStyle}
          labelShowBg={p.labelShowBg}
        />
      </g>
      <InsertSlot
        p={{ source: p.source, target: p.target, x: hasLabel ? lx - 34 : lx, y: ly }}
        hover={hover}
        on={on}
      />
    </>
  );
}

export const ForwardEdge = memo(ForwardEdgeImpl);

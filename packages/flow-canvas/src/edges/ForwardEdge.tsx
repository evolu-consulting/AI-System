// CR-122 · P8: cạnh tiến có nút "+" chèn bước ở giữa (kiểu `forward`; vẫn vẽ nhãn "Duyệt"/"⚠" của host như cạnh mặc định).
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { InsertSlot, useEdgeHover } from "./InsertSlot";
import { useRoutedPath } from "./use-route";

function ForwardEdgeImpl(p: EdgeProps) {
  // CR-125 · x9: đường định tuyến né node; nút "+" nằm đúng GIỮA đường, nhãn (nếu có) lệch về phía đích.
  const { path, mid, at } = useRoutedPath(p, 12);
  const { hover, on } = useEdgeHover();
  const hasLabel = p.label !== undefined && p.label !== "";
  const lab = hasLabel ? at(40) : mid;
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
          labelX={lab.x}
          labelY={lab.y}
          labelStyle={p.labelStyle}
          labelBgStyle={p.labelBgStyle}
          labelShowBg={p.labelShowBg}
        />
      </g>
      <InsertSlot
        p={{ source: p.source, target: p.target, x: mid.x, y: mid.y }}
        hover={hover}
        on={on}
      />
    </>
  );
}

export const ForwardEdge = memo(ForwardEdgeImpl);

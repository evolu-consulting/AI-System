// CR-122 · P8: chỗ đặt nút "+" giữa cạnh. Hiện khi rê chuột lên cạnh / nút, luôn hiện trên màn cảm ứng (hover: none);
// nội dung nút (menu "Thêm bước") do host dựng qua `renderEdgeInsert`.
import { EdgeLabelRenderer } from "@xyflow/react";
import { type ReactNode, useState } from "react";
import { useFlowHost } from "../context";

type Props = { source: string; target: string; side?: "yes" | "no"; x: number; y: number };

export function useEdgeHover() {
  const [hover, setHover] = useState(false);
  return { hover, on: { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } };
}

export function InsertSlot({
  p,
  hover,
  on,
}: {
  p: Props;
  hover: boolean;
  on: ReturnType<typeof useEdgeHover>["on"];
}): ReactNode {
  const { renderEdgeInsert, mode } = useFlowHost();
  if (mode !== "edit" || !renderEdgeInsert) return null;
  return (
    <EdgeLabelRenderer>
      <div
        {...on}
        style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
        className={`nodrag nopan pointer-events-auto absolute transition-opacity focus-within:opacity-100 hover:opacity-100 [@media(hover:none)]:opacity-100 ${hover ? "opacity-100" : "opacity-0"}`}
      >
        {renderEdgeInsert({ source: p.source, target: p.target, side: p.side })}
      </div>
    </EdgeLabelRenderer>
  );
}

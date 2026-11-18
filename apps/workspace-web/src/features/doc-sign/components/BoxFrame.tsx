// CR-181 · khung kéo/đổi cỡ/bàn phím dùng chung cho MarkBox và FieldBox. Toạ độ px trên sân khấu.
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { type Corner, clampToStage, nudge, resizeKeepAspect } from "../lib/actions";
import type { Rect } from "../lib/geometry";
import { boxKeyAction } from "../lib/keys";
import { type Seam, snapToSeams } from "../lib/snap";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const POS: Record<Corner, string> = {
  nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
  ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
  sw: "-left-1.5 -bottom-1.5 cursor-nesw-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
};

export type BoxFrameProps = {
  rect: Rect;
  editable: boolean;
  selected: boolean;
  aspect: number;
  stage: { width: number; height: number };
  seams: Seam[];
  ariaLabel: string;
  tag: string;
  toneClass: string;
  testId?: string;
  onSelect: () => void;
  onDeselect: () => void;
  onSeam: (s: Seam | null) => void;
  onCommit: (r: Rect) => void;
  onDelete: () => void;
  onContext?: (x: number, y: number) => void;
  children: ReactNode;
};

export function BoxFrame(p: BoxFrameProps) {
  const [live, setLive] = useState<Rect | null>(null);
  const drag = useRef<{ x: number; y: number; start: Rect; corner?: Corner } | null>(null);
  const r = live ?? p.rect;

  const begin = (e: PointerEvent, corner?: Corner) => {
    if (!p.editable) return;
    e.stopPropagation();
    p.onSelect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: p.rect, corner };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (d.corner) {
      setLive(resizeKeepAspect(d.start, d.corner, dx, p.aspect));
      return;
    }
    const moved = clampToStage(
      { ...d.start, l: d.start.l + dx, t: d.start.t + e.clientY - d.y },
      p.stage,
    );
    const s = snapToSeams(moved, p.seams);
    p.onSeam(s.seam);
    setLive(s.rect);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    p.onSeam(null);
    if (live) p.onCommit(live);
    setLive(null);
  };
  const key = (e: React.KeyboardEvent) => {
    const a = boxKeyAction(e.key, p.editable);
    if (!a) return;
    e.preventDefault();
    if (a.type === "nudge") p.onCommit(clampToStage(nudge(p.rect, a.key), p.stage));
    else if (a.type === "delete") p.onDelete();
    else p.onDeselect();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: khung kéo thả có nút con, không thể là phần tử nút
    <div
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: ô phải nhận bàn phím (mũi tên/Delete/Esc)
      tabIndex={0}
      aria-label={p.ariaLabel}
      data-testid={p.testId}
      className={`absolute z-10 touch-none rounded-sm border-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${p.toneClass} ${p.editable ? "cursor-move" : ""} ${p.selected ? "ring-2 ring-ring" : ""}`}
      style={{ left: r.l, top: r.t, width: r.w, height: r.h }}
      onPointerDown={(e) => begin(e)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key}
      onFocus={p.onSelect}
      onContextMenu={(e) => {
        if (!p.onContext) return;
        e.preventDefault();
        e.stopPropagation();
        p.onContext(e.clientX, e.clientY);
      }}
    >
      <span className="absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-background/90 px-1 text-xs">
        {p.tag}
      </span>
      {p.children}
      {p.editable &&
        p.selected &&
        CORNERS.map((c) => (
          <span
            key={c}
            aria-hidden="true"
            data-corner={c}
            className={`absolute size-3 rounded-sm border bg-background ${POS[c]}`}
            onPointerDown={(e) => begin(e, c)}
          />
        ))}
    </div>
  );
}

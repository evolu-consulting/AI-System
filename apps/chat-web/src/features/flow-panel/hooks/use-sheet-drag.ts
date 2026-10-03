// CHAT-AC-17 · kéo tay nắm sheet xuống: theo ngón tay/chuột, quá ngưỡng thì đóng, chưa tới thì bật về.
import { type PointerEvent, useRef, useState } from "react";
import { dragShouldClose } from "../lib/flow-panel-logic";

/** Dịch < 6px coi như bấm (Enter/Space/bấm tay nắm cũng đóng). */
const TAP_PX = 6;

export function useSheetDrag(onClose: () => void) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(0);
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = e.clientY;
    moved.current = 0;
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    const d = Math.max(0, e.clientY - start.current);
    moved.current = Math.max(moved.current, d);
    setDy(d);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    const d = Math.max(0, e.clientY - start.current);
    start.current = null;
    setDy(0);
    if (dragShouldClose(d)) onClose();
  };
  const onClick = () => {
    if (moved.current < TAP_PX) onClose();
    moved.current = 0;
  };
  return {
    dy,
    dragging: dy > 0,
    grip: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick },
  };
}

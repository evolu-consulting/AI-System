// Polish UI · bề rộng panel flow bên phải kéo đổi được (min–max), nhớ trong localStorage (lỗi/thiếu → mặc định).
import { type KeyboardEvent, type PointerEvent, useCallback, useRef, useState } from "react";
import { readLocal, writeLocal } from "~/lib/storage";

export const PANEL_MIN_PX = 360;
export const PANEL_MAX_PX = 720;
export const PANEL_DEFAULT_PX = 420;
const KEY = "chat:flow-panel:width";
const STEP = 16;

const clamp = (n: number) => Math.min(PANEL_MAX_PX, Math.max(PANEL_MIN_PX, Math.round(n)));

function load(): number {
  const n = Number(readLocal(KEY));
  return Number.isFinite(n) && n > 0 ? clamp(n) : PANEL_DEFAULT_PX;
}

export function usePanelWidth() {
  const [width, setWidth] = useState(load);
  const latest = useRef(width);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((w: number) => {
    const next = clamp(w);
    latest.current = next;
    setWidth(next);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: latest.current };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d) apply(d.w + (d.x - e.clientX)); // kéo sang trái → rộng ra
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    writeLocal(KEY, String(latest.current));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const delta = e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0;
    if (!delta) return;
    e.preventDefault();
    apply(latest.current + delta);
    writeLocal(KEY, String(latest.current));
  };

  return {
    width,
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown,
    },
  };
}

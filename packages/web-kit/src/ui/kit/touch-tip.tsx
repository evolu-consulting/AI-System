// CR-185 · Tooltip có chạm: rê chuột / focus ⇒ hiện; điện thoại chạm một cái (`tap`) hoặc chạm-giữ ⇒ hiện, tự tắt sau 2,5 s. MỘT bản duy nhất.
// Gốc lỗi «chạm không hiện» (fix-cr185-tap): (1) ngón tay luôn rung vài px ⇒ `touchmove` bị coi là cuộn ⇒ bỏ cú chạm; (2) Radix gửi lệnh đóng
// (pointerleave / click / blur) ngay sau chạm. Nay: chỉ coi là cuộn khi lệch > MOVE_PX, và khi mở bằng chạm thì bỏ MỌI lệnh đóng của Radix tới khi hết giờ.
import { type ReactElement, type TouchEvent, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const HOLD_MS = 400;
export const SHOW_MS = 2500;
/** Lệch quá ngần này px mới là cuộn/kéo; dưới đó vẫn là chạm. */
export const MOVE_PX = 10;
/** Sau chạm, Radix còn gửi `click`/`pointerleave` ⇒ đóng tooltip ngay; bỏ qua lệnh đóng trong khoảng này. */
const TAP_GUARD_MS = 500;

/** Lệnh đóng ngay sau một cú chạm là `click` đi kèm ⇒ bỏ qua (để tên không nháy rồi tắt). */
export const ignoreClose = (now: number, tapAt: number): boolean => now - tapAt < TAP_GUARD_MS;

/** Ngón tay đã kéo đi đủ xa để là cuộn chưa. */
export const movedFar = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > MOVE_PX;

/**
 * Bọc MỘT phần tử (asChild) bằng tooltip có thêm chạm. `tap` ⇒ chạm một cái cũng hiện (phần tử chỉ để xem);
 * không bật `tap` cho phần tử đã có việc khi bấm (menu, nút) — ở đó chỉ chạm-giữ.
 */
export function TouchTip({
  tip,
  tap,
  children,
}: {
  tip: string;
  tap?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const touchOpen = useRef(false);
  const tapAt = useRef(0);
  const clearHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (hide.current) clearTimeout(hide.current);
    },
    [],
  );
  const show = () => {
    tapAt.current = Date.now();
    touchOpen.current = true;
    setOpen(true);
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => {
      touchOpen.current = false;
      setOpen(false);
    }, SHOW_MS);
  };
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start.current = t ? { x: t.clientX, y: t.clientY } : null;
    moved.current = false;
    clearHold();
    timer.current = setTimeout(show, HOLD_MS);
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || !start.current) return;
    if (movedFar(t.clientX - start.current.x, t.clientY - start.current.y)) {
      moved.current = true;
      clearHold();
    }
  };
  const onTouchEnd = () => {
    clearHold();
    if (tap && !moved.current) show();
  };
  const onOpenChange = (o: boolean) => {
    if (!o && (touchOpen.current || ignoreClose(Date.now(), tapAt.current))) return;
    setOpen(o);
  };
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger
        asChild
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

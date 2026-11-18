// CR-185 · Tooltip có chạm: rê chuột / focus ⇒ hiện; điện thoại chạm-giữ (hoặc chạm một cái khi `tap`) ⇒ hiện, tự tắt sau 2,5 s. MỘT bản duy nhất (trước ở workspace-web).
import { type ReactElement, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const HOLD_MS = 400;
const SHOW_MS = 2500;
/** Sau chạm, Radix còn gửi `click` ⇒ đóng tooltip ngay; bỏ qua lệnh đóng trong khoảng này. */
const TAP_GUARD_MS = 500;

/** Lệnh đóng ngay sau một cú chạm là `click` đi kèm ⇒ bỏ qua (để tên không nháy rồi tắt). */
export const ignoreClose = (now: number, tapAt: number): boolean => now - tapAt < TAP_GUARD_MS;

/**
 * Bọc MỘT phần tử (asChild) bằng tooltip có thêm chạm-giữ. `tap` ⇒ chạm một cái cũng hiện (phần tử chỉ để xem);
 * không bật `tap` cho phần tử đã có việc khi bấm (menu, nút).
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
  const moved = useRef(false);
  const tapAt = useRef(0);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    setOpen(true);
    timer.current = setTimeout(() => setOpen(false), SHOW_MS);
  };
  const onTouchEnd = () => {
    if (!tap || moved.current) return;
    clear();
    tapAt.current = Date.now();
    show();
  };
  const onTouchStart = () => {
    moved.current = false;
    clear();
    timer.current = setTimeout(show, HOLD_MS);
  };
  const onTouchMove = () => {
    moved.current = true;
    clear();
  };
  const onOpenChange = (o: boolean) => {
    if (!o && ignoreClose(Date.now(), tapAt.current)) return;
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

// CR-184 · Avatar có tooltip: rê chuột / focus bàn phím / chạm giữ (điện thoại) ⇒ hiện `tip`. Chữ của tip cũng có trong DOM (sr-only) cho đọc màn hình.
import { Avatar, type AvatarSize } from "@ai/web-kit/ui/kit/avatar";
import { cn } from "@ai/web-kit/ui/kit/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { type ReactElement, type ReactNode, useRef, useState } from "react";

const HOLD_MS = 400;
const SHOW_MS = 2500;
/** Sau chạm, Radix còn gửi `click` ⇒ đóng tooltip ngay; bỏ qua lệnh đóng trong khoảng này. */
const TAP_GUARD_MS = 500;

/** Lệnh đóng ngay sau một cú chạm là `click` đi kèm ⇒ bỏ qua (để tên không nháy rồi tắt). */
export const ignoreClose = (now: number, tapAt: number): boolean => now - tapAt < TAP_GUARD_MS;

/**
 * Bọc MỘT phần tử (asChild) bằng tooltip có thêm chạm-giữ. `tap` ⇒ chạm một cái cũng hiện tên (avatar chỉ để xem, điện thoại không có rê chuột);
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
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const moved = useRef(false);
  const tapAt = useRef(0);
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

export function AvatarTip({
  name,
  src,
  tip,
  size = 32,
  ring,
  badge,
  testId,
}: {
  name: string;
  src?: string | null;
  tip: string;
  size?: AvatarSize;
  /** Lớp viền màu (vd `ring-act`). */
  ring?: string;
  /** Dấu nhỏ ở góc dưới phải (vd dấu ✓ đã ký). */
  badge?: ReactNode;
  testId?: string;
}) {
  return (
    <TouchTip tip={tip} tap>
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: avatar cần focus bàn phím để hiện tooltip
        tabIndex={0}
        data-testid={testId}
        className="relative inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar name={name} src={src} size={size} className={cn(ring && `ring-2 ${ring}`)} />
        {badge}
        <span className="sr-only">{tip}</span>
      </span>
    </TouchTip>
  );
}

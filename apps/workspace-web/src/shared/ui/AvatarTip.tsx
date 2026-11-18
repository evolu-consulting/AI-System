// CR-184 · Avatar có tooltip: rê chuột / focus bàn phím / chạm giữ (điện thoại) ⇒ hiện `tip`. Chữ của tip cũng có trong DOM (sr-only) cho đọc màn hình.
import { Avatar, type AvatarSize } from "@ai/web-kit/ui/kit/avatar";
import { cn } from "@ai/web-kit/ui/kit/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { type ReactElement, type ReactNode, useRef, useState } from "react";

const HOLD_MS = 400;
const SHOW_MS = 2500;

/** Bọc MỘT phần tử (asChild) bằng tooltip có thêm chạm-giữ. */
export function TouchTip({ tip, children }: { tip: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onTouchStart = () => {
    clear();
    timer.current = setTimeout(() => {
      setOpen(true);
      timer.current = setTimeout(() => setOpen(false), SHOW_MS);
    }, HOLD_MS);
  };
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild onTouchStart={onTouchStart} onTouchMove={clear}>
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
    <TouchTip tip={tip}>
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

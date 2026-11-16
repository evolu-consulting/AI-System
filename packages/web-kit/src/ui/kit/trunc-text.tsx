// CR-179 · TruncText: chữ dài bị cắt «…» (1 hoặc 2 dòng); CHỈ khi thật sự tràn mới có tooltip đủ chữ + focus bàn phím.
// Không tràn ⇒ không tooltip, không thêm tab stop. Đo tràn ở hàm thuần `isOverflowing` (test được).
import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export type OverflowBox = {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Một dòng: so bề ngang; nhiều dòng (line-clamp): so bề cao. Dung sai 1px cho làm tròn. */
export function isOverflowing(el: OverflowBox, lines: 1 | 2 = 1): boolean {
  return lines === 1 ? el.scrollWidth - el.clientWidth > 1 : el.scrollHeight - el.clientHeight > 1;
}

export type TruncTextProps = {
  /** Chữ đầy đủ (tooltip + aria-label khi tràn). */
  text: string;
  /** Nội dung hiển thị; bỏ trống ⇒ `text`. */
  children?: ReactNode;
  as?: ElementType;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  lines?: 1 | 2;
  /** false khi đã nằm trong liên kết/nút (đã focus được) ⇒ không thêm tab stop. */
  focusable?: boolean;
  "data-testid"?: string;
};

export function TruncText({
  text,
  children,
  as: Tag = "span",
  className,
  style,
  lines = 1,
  focusable = true,
  "data-testid": testId,
}: TruncTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const measure = () => {
    if (ref.current) setOver(isOverflowing(ref.current, lines));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: đo lại khi chữ/số dòng đổi, và khi khung đổi cỡ
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);
  const cls = cn(lines === 1 ? "truncate" : "line-clamp-2 break-words", "min-w-0", className);
  return (
    <Tooltip
      open={over ? undefined : false}
      onOpenChange={(o) => {
        if (o) measure();
      }}
    >
      <TooltipTrigger asChild>
        <Tag
          ref={ref}
          style={style}
          data-testid={testId}
          className={cls}
          tabIndex={over && focusable ? 0 : undefined}
          aria-label={over && focusable ? text : undefined}
          onMouseEnter={measure}
          onFocus={measure}
        >
          {children ?? text}
        </Tag>
      </TooltipTrigger>
      <TooltipContent className="break-words">{text}</TooltipContent>
    </Tooltip>
  );
}

// CR-134 · chữ dài: MỘT dòng, cắt «…». CR-179: dùng TruncText của kit — chỉ khi tràn mới có tooltip đủ chữ.
// Chỗ nào chữ có thể dài hơn khung thì bọc ở đây thay vì tự viết `truncate`.
import { TruncText as KitTruncText } from "@ai/web-kit/ui/kit/trunc-text";
import type { ElementType, ReactNode } from "react";
import { cn } from "~/lib/utils";

export type TruncTextProps = {
  children: ReactNode;
  /** Nội dung đầy đủ cho tooltip; bỏ trống ⇒ dùng `children` khi là chuỗi. */
  title?: string | undefined;
  /** Chiều rộng tối đa (CSS, vd "12rem"); bỏ trống ⇒ co theo khung cha (cha cần `min-w-0`). */
  maxWidth?: string | undefined;
  className?: string | undefined;
  as?: ElementType;
};

export function TruncText({ children, title, maxWidth, className, as }: TruncTextProps) {
  "use no memo"; // component nhỏ, render rẻ: bỏ bộ nhớ đệm của React Compiler cho chunk gọn (check:bundle)
  const full = title ?? (typeof children === "string" ? children : undefined);
  const cls = cn("inline-block max-w-full align-bottom", className);
  const style = maxWidth ? { maxWidth } : undefined;
  if (full === undefined)
    return (
      <span style={style} className={cn(cls, "truncate")}>
        {children}
      </span>
    );
  return (
    <KitTruncText text={full} as={as} style={style} className={cls}>
      {children}
    </KitTruncText>
  );
}

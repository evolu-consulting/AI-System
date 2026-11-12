// CR-134 · chữ dài: MỘT dòng, cắt bằng «…», rê chuột/trình đọc màn hình thấy đủ nội dung (`title`). Dùng cho tên file, tên đối tác/HĐ,
// dòng thông tin — chỗ nào chữ có thể dài hơn khung thì bọc ở đây thay vì tự viết `truncate`.
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

export function TruncText({
  children,
  title,
  maxWidth,
  className,
  as: Tag = "span",
}: TruncTextProps) {
  "use no memo"; // component nhỏ, render rẻ: bỏ bộ nhớ đệm của React Compiler cho chunk gọn (check:bundle)
  const full = title ?? (typeof children === "string" ? children : undefined);
  return (
    <Tag
      title={full}
      style={maxWidth ? { maxWidth } : undefined}
      className={cn("inline-block min-w-0 max-w-full truncate align-bottom", className)}
    >
      {children}
    </Tag>
  );
}

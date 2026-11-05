// V2-F · mockup NITI `.tag` (+ tag-ok / tag-soon / tag-late / tag-grey): nhãn nhỏ theo sắc thái (loại HĐ, giai đoạn, Nhập/Xuất kho, lỗi).
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type TagTone = "act" | "ok" | "soon" | "late" | "grey";
const TONE: Record<TagTone, string> = {
  act: "bg-act-soft text-act",
  ok: "bg-ok-bg text-ok",
  soon: "bg-soon-bg text-soon",
  late: "bg-late-bg text-late",
  grey: "bg-sunk text-dim",
};

export function Tag({
  tone = "act",
  children,
  className,
  title,
}: {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] items-center rounded-md px-2 text-[12px] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

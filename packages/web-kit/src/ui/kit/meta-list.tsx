// CR-180 · Dòng «nhãn: giá trị». Desktop: một hàng «A · B · C» (dấu «·» là CSS giả giữa các mục, không bao giờ đầu/cuối dòng).
// Điện thoại: lưới 2 cột thẳng hàng (cột nhãn rộng theo nhãn dài nhất, cột giá trị co giãn); giá trị dài xuống dòng TRONG cột giá trị.
// Mục rỗng (value null/""/false) bị bỏ.
import type { ReactNode } from "react";
import { cn } from "./cn";

export type MetaItem = { label: string; value: ReactNode };

export const hasValue = (v: ReactNode): boolean =>
  v !== null && v !== undefined && v !== "" && v !== false;

export function MetaList({ items, className }: { items: MetaItem[]; className?: string }) {
  const shown = items.filter((i) => hasValue(i.value));
  if (shown.length === 0) return null;
  return (
    <dl
      data-slot="meta-list"
      className={cn(
        "m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground max-sm:grid max-sm:grid-cols-[max-content_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1.5",
        className,
      )}
    >
      {shown.map((i) => (
        <div
          key={i.label}
          data-slot="meta-item"
          className="flex min-w-0 gap-1 max-sm:contents sm:not-first:before:mr-1 sm:not-first:before:content-['·']"
        >
          <dt className="sm:sr-only max-sm:after:content-[':']">{i.label}</dt>
          <dd className="m-0 min-w-0 break-words text-foreground">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

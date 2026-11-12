// CR-134 · khuôn loading chung (xem lib/load-phase.ts): `Refreshing` bọc khối số liệu — khi `fetching` hiện thanh chạy mảnh phía trên,
// nội dung cũ mờ nhẹ (vẫn đọc được), `aria-busy` cho trình đọc màn hình. `PaneSkeleton` là khung xương lần tải đầu (có nhãn ẩn cho a11y/e2e).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

export function Refreshing({
  fetching,
  children,
  className,
}: {
  fetching: boolean;
  children: ReactNode;
  className?: string;
}) {
  "use no memo"; // component nhỏ, render rẻ: bỏ bộ nhớ đệm của React Compiler cho chunk gọn (check:bundle)
  return (
    <div
      className={cn("relative", className)}
      aria-busy={fetching || undefined}
      data-refreshing={fetching ? "true" : undefined}
    >
      {fetching && (
        <span
          aria-hidden="true"
          data-testid="refreshing-bar"
          className="absolute inset-x-0 top-0 h-0.5 animate-pulse rounded bg-act"
        />
      )}
      <div className={cn("transition-opacity", fetching && "opacity-60")}>{children}</div>
    </div>
  );
}

export function PaneSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">{t("contracts.common.loading")}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: khung xương tĩnh
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

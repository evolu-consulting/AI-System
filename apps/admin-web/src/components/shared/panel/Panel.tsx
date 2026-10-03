// ADM-FR-41, ADM-FR-42 · khung card của Tổng quan: `section` có `aria-labelledby` (e2e `region "<tiêu đề>"`), lỗi/tải riêng từng card (ms §12.3).
import { type ReactNode, useId } from "react";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoadError } from "@/lib/load-error";

type Props = {
  title: string;
  loading?: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
  /** Link/nút cuối card ("Xem tất cả", "Xem nhật ký"…). */
  footer?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, loading, error, footer, children }: Props) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      aria-busy={loading || undefined}
      className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
    >
      <h2 id={id} className="text-body font-semibold text-foreground">
        {title}
      </h2>
      {error ? (
        <ErrorState {...error} />
      ) : loading ? (
        <div aria-hidden className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : (
        <>
          {children}
          {footer ? <div className="text-label">{footer}</div> : null}
        </>
      )}
    </section>
  );
}

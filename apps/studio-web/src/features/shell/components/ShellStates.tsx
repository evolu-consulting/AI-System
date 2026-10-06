// HUB-FR-72 · plan-frontend §3 hàng Khung: chờ `me` → skeleton sidebar + topbar; `me` lỗi mạng → ErrorState toàn trang + Thử lại.
import { useRouter } from "@tanstack/react-router";
import { ErrorState } from "#/components/shared/ErrorState";
import { Skeleton } from "#/components/ui/skeleton";

export function ShellSkeleton() {
  return (
    <div className="flex h-screen bg-background" aria-busy="true">
      <div className="hidden w-sidebar shrink-0 space-y-3 border-r border-sidebar-border bg-sidebar p-4 lg:block">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dòng skeleton tĩnh
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-topbar items-center justify-end gap-3 border-b border-border bg-card px-6">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  );
}

export function ShellError({ error }: { error: unknown }) {
  const router = useRouter();
  // Mã lỗi của ApiError (đọc theo cấu trúc: component không import lib/http).
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? raw : undefined;
  return (
    <main id="main" className="mx-auto w-full max-w-content p-page">
      <ErrorState code={code} onRetry={() => void router.invalidate()} />
    </main>
  );
}

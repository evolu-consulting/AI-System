// P-c2 · tách chunk: khối kết quả/quyết định Áp chỉ nạp khi có dữ liệu `apply` (giữ bundle đầu ≤ 150 KB).
import { type ComponentProps, lazy, Suspense } from "react";
import { Skeleton } from "~/components/ui/skeleton";

const Result = lazy(() => import("./ApplyResult"));
const Issue = lazy(() => import("./ApplyIssue"));
const fallback = <Skeleton aria-busy="true" className="h-12 w-full" />;

export function LazyApplyResult(props: ComponentProps<typeof Result>) {
  return (
    <Suspense fallback={fallback}>
      <Result {...props} />
    </Suspense>
  );
}

export function LazyApplyIssue(props: ComponentProps<typeof Issue>) {
  return (
    <Suspense fallback={fallback}>
      <Issue {...props} />
    </Suspense>
  );
}

// ADM-FR-55 · ConflictDialog nạp `lazy()` (plan-frontend §6): không vào bundle ban đầu, chỉ tải khi có xung đột.
import { lazy, Suspense } from "react";
import type { ConflictDialogProps } from "./ConflictDialog";

const ConflictDialog = lazy(() => import("./ConflictDialog"));

export function LazyConflictDialog({ props }: { props: ConflictDialogProps | null }) {
  if (!props) return null;
  return (
    <Suspense fallback={null}>
      <ConflictDialog {...props} />
    </Suspense>
  );
}

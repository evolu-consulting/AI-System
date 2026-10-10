// CR-056 · P-a plan-frontend-thread §3: nội dung một bản kết quả (Markdown, tải lười theo `output_id`, `staleTime: Infinity`).
// Bước 0: khung dữ liệu + trạng thái; PF1/PF3 dựng tab "Phiên bản" quanh nó.
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { useOutput } from "../hooks/use-output";

const Markdown = lazy(() => import("~/features/answer/components/Markdown"));

export type OutputViewProps = { runId: string; outputId: string };

export function OutputView({ runId, outputId }: OutputViewProps) {
  const { t } = useTranslation();
  const q = useOutput(runId, outputId);
  if (q.isPending) return <Skeleton aria-busy="true" className="h-16 w-full" />;
  if (q.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("process.common.error.load")}{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          {t("process.common.error.retry")}
        </button>
      </p>
    );
  }
  return (
    <div className="text-sm">
      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        <Markdown content={q.data.content} />
      </Suspense>
    </div>
  );
}

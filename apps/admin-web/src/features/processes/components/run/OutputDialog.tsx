// ADM-FR-67 · CR-056 · P-a F5: hộp thoại "Kết quả giai đoạn … · v…" — nội dung `<pre>` từ `/outputs/:oid` (admin xem `full`).
import type { StageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunOutput } from "../../hooks/use-run-data";
import { KnowledgeNotice } from "./KnowledgeNotice";

export type OutputTarget = {
  id: string;
  stage: string;
  version: number;
  knowledge?: StageView["knowledge"];
};
type Props = {
  runId: string;
  tenantId: string | undefined;
  target: OutputTarget | null;
  onClose: () => void;
};

export function OutputDialog({ runId, tenantId, target, onClose }: Props) {
  // Chuỗi `process.*` nạp lười (ngoài kiểu `resources`) ⇒ t không ràng buộc khoá.
  const t = useTranslation().t as (key: string, opt?: Record<string, unknown>) => string;
  const q = useRunOutput(runId, target?.id ?? null, tenantId);
  const title = t("process.admin.run.outputTitle", {
    stage: target?.stage ?? "",
    n: target?.version ?? 0,
  });
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {q.isPending ? <Skeleton className="h-40 w-full" /> : null}
        {q.isError ? (
          <div role="alert" className="flex items-center gap-2 text-body">
            {t("process.common.error.load")}
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              {t("process.common.error.retry")}
            </Button>
          </div>
        ) : null}
        {q.data ? <OutputBody content={q.data.content} knowledge={target?.knowledge} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// HUB-FR-134 · K1 F3: nội dung + ghi chú tri thức dưới `<pre>`.
export function OutputBody({
  content,
  knowledge,
}: {
  content: string;
  knowledge?: StageView["knowledge"];
}) {
  return (
    <div className="space-y-2">
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-label">
        {content}
      </pre>
      <KnowledgeNotice knowledge={knowledge} />
    </div>
  );
}

// platform/gd0_dlc_fix · nút "Xem và duyệt" trên thẻ run DLC (chỉ key `dlc-*`) → modal: kết quả đầy đủ của bước + Duyệt / Từ chối.
// Duyệt = `pass` (đi tiếp). Từ chối = `fail` + lý do + quay lại bước cấu hình cho điểm duyệt (lib/dlc-review). Lỗi ⇒ câu riêng.
import { FEEDBACK_MAX, type ProcessRunSummary } from "@ai/contracts/chat";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { OutputView } from "../../shared/components/OutputView";
import { useProcessRun } from "../../shared/hooks/use-process-run";
import { processKeys } from "../../shared/keys";
import { useReviewDecision } from "../hooks/use-review-actions";
import { type DlcReviewTarget, dlcReviewTarget, isDlcProcess } from "../lib/dlc-review";
import { reviewErrorMessage } from "../lib/review-error";

/** Có hiện nút không: chỉ run DLC đang chờ kiểm. */
export const showDlcReview = (run: ProcessRunSummary): boolean =>
  isDlcProcess(run.process.key) && run.status === "waiting_review";

export function DlcReviewButton({ run }: { run: ProcessRunSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="self-start">
          {t("process.run.dlcReview.open")}
        </Button>
      </DialogTrigger>
      {open && <DlcReviewContent runId={run.id} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function DlcReviewContent({ runId, onDone }: { runId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const q = useProcessRun(runId);
  const target = dlcReviewTarget(q.data);
  return (
    <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {target
            ? t("process.run.dlcReview.title", { stage: target.stage.name })
            : t("process.run.dlcReview.titleEmpty")}
        </DialogTitle>
        <DialogDescription>{q.data?.process.name ?? ""}</DialogDescription>
      </DialogHeader>
      {q.isPending ? (
        <p className="text-sm text-secondary-foreground">{t("process.run.dlcReview.loading")}</p>
      ) : target ? (
        <DlcReviewBody runId={runId} target={target} onDone={onDone} />
      ) : (
        <p className="text-sm text-secondary-foreground">{t("process.run.dlcReview.none")}</p>
      )}
    </DialogContent>
  );
}

function DlcReviewBody(p: { runId: string; target: DlcReviewTarget; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mut = useReviewDecision(p.runId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { target } = p;
  const over = reason.length > FEEDBACK_MAX;
  const send = async (result: "pass" | "fail") => {
    setErr(null);
    try {
      await mut.mutateAsync({
        taskId: target.taskId,
        result,
        ...(result === "fail" ? { feedback: reason.trim(), backToStep: target.backToStep } : {}),
      });
      void qc.invalidateQueries({ queryKey: processKeys.all });
      toast.success(
        result === "pass"
          ? t("process.run.dlcReview.approved", { stage: target.stage.name })
          : t("process.run.dlcReview.rejected", { step: target.backStepName }),
      );
      p.onDone();
    } catch (e) {
      const msg = reviewErrorMessage(e, t);
      if (msg === null) {
        toast.message(t("process.run.review.taken"));
        p.onDone();
      } else setErr(msg);
    }
  };
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-3">
        {target.outputId ? (
          <OutputView runId={p.runId} outputId={target.outputId} />
        ) : (
          <p className="text-sm text-secondary-foreground">{t("process.run.dlcReview.noOutput")}</p>
        )}
      </div>
      {rejecting && (
        <div className="flex flex-col gap-1">
          <p className="text-caption text-secondary-foreground">
            {t("process.run.dlcReview.backTo", { step: target.backStepName })}
          </p>
          <Textarea
            autoFocus
            aria-label={t("process.run.dlcReview.reason")}
            placeholder={t("process.run.dlcReview.reason")}
            value={reason}
            maxLength={FEEDBACK_MAX + 1}
            onChange={(e) => setReason(e.target.value)}
          />
          {over && (
            <p className="text-caption text-destructive">
              {t("process.common.validate.tooLong", { max: FEEDBACK_MAX })}
            </p>
          )}
        </div>
      )}
      {err && <p className="text-caption text-destructive">{err}</p>}
      <DialogFooter>
        {rejecting ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
              {t("process.run.review.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reason.trim().length === 0 || over || mut.isPending}
              onClick={() => void send("fail")}
            >
              {t("process.run.dlcReview.rejectSubmit")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
              {t("process.run.dlcReview.reject")}
            </Button>
            <Button type="button" disabled={mut.isPending} onClick={() => void send("pass")}>
              {t("process.run.dlcReview.approve")}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

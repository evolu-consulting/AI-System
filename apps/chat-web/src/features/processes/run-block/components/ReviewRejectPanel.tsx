// N2-FR-02 · HD-FR-36 · HD3: nút "Từ chối" của thẻ kiểm — lý do bắt buộc (≤ FEEDBACK_MAX), kết thúc lượt chạy. Lỗi engine
// (người bắt đầu ở bước `exclude_starter` ⇒ 403 STARTER_CANNOT_REVIEW) hiện câu riêng; việc đã đóng ⇒ báo "đã có người quyết".
import { FEEDBACK_MAX } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useReviewDecision } from "../hooks/use-review-actions";
import { reviewErrorMessage } from "../lib/review-error";

export function ReviewRejectPanel({
  runId,
  taskId,
  stage,
  onDone,
  onCancel,
}: {
  runId: string;
  taskId: string;
  stage: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const mut = useReviewDecision(runId);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const over = reason.length > FEEDBACK_MAX;
  const ok = reason.trim().length > 0 && !over && !mut.isPending;
  const submit = async () => {
    setErr(null);
    try {
      await mut.mutateAsync({ taskId, result: "reject", feedback: reason.trim() });
      toast.success(t("process.run.review.rejected", { stage }));
      onDone();
    } catch (e) {
      const msg = reviewErrorMessage(e, t);
      if (msg === null) {
        toast.message(t("process.run.review.taken"));
        onDone();
      } else setErr(msg);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        aria-label={t("process.run.review.rejectReason")}
        value={reason}
        maxLength={FEEDBACK_MAX + 1}
        onChange={(e) => setReason(e.target.value)}
      />
      {over && (
        <p className="text-caption text-destructive">
          {t("process.common.validate.tooLong", { max: FEEDBACK_MAX })}
        </p>
      )}
      {err && <p className="text-caption text-destructive">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!ok}
          onClick={() => void submit()}
        >
          {t("process.run.review.rejectSubmit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("process.run.review.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** Nút "Từ chối" dưới hàng Đạt / Chưa đạt; bấm ⇒ mở ô lý do (trạng thái riêng, không làm nặng thẻ kiểm). */
export function ReviewRejectAction(p: {
  runId: string;
  taskId: string;
  stage: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {t("process.common.result.reject")}
        </Button>
      </div>
    );
  return <ReviewRejectPanel {...p} onCancel={() => setOpen(false)} />;
}

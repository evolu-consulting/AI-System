// CHAT-AC-60 · HUB-FR-118 · plan-frontend §4: panel "Chưa đạt thì…" của thẻ kiểm có tuỳ chọn quay lại — radiogroup (Làm lại
// giai đoạn này | Quay lại bước X), góp ý BẮT BUỘC, cảnh báo còn n lần / hết lượt. Tự gửi (`useReviewDecision`); thẻ cha chỉ
// nhận kết quả. Lỗi: 409 đóng ⇒ toast "vừa được xử lý ở bước khác"; 422 đích ⇒ câu tĩnh (view được làm tươi).
import { FEEDBACK_MAX, PROCESS_BACK_ROUNDS_MAX, type TaskDetail } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { useReviewDecision } from "../hooks/use-review-actions";
import { reviewErrorMessage } from "../lib/review-error";

const REDO = "redo";

type Props = {
  runId: string;
  task: TaskDetail;
  /** Tên các giai đoạn của mỗi bước (đích → tên) để gợi ý "Chạy lại: …"; vắng ⇒ không có gợi ý. */
  stageNames?: (step: number) => string;
  /** Trần quay lại của run (view.back_limit); vắng ⇒ hằng contract. */
  backMax?: number;
  agent: string;
  left: number;
  onSent: () => void;
  onCancel: () => void;
};

function Option({
  id,
  value,
  label,
  hint,
}: {
  id: string;
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem
        id={id}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={`${id}-hint`} className="text-caption text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function ReviewFailPanel(props: Props) {
  const { runId, task, stageNames, backMax, agent, left, onSent, onCancel } = props;
  const { t } = useTranslation();
  const uid = useId();
  const mut = useReviewDecision(runId);
  const steps = task.back_steps ?? [];
  const [pick, setPick] = useState(REDO);
  const [feedback, setFeedback] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Tuỳ chọn đã bị làm tươi mất (422/409) ⇒ quay về "Làm lại giai đoạn này".
  const choice = steps.some((s) => String(s) === pick) ? pick : REDO;
  const backTo = choice === REDO ? undefined : Number(choice);
  const over = feedback.length > FEEDBACK_MAX;
  const roundsLeft = task.back_rounds_left ?? 0;

  const send = async () => {
    const text = feedback.trim();
    if (!text) return setErr(t("process.common.validate.feedbackRequired"));
    setErr(null);
    try {
      await mut.mutateAsync({
        taskId: task.id,
        result: "fail",
        feedback: text,
        backToStep: backTo,
      });
      if (backTo === undefined) toast.success(t("process.run.review.sent", { agent, n: left }));
      else if (roundsLeft <= 0) toast.success(t("process.run.review.sentDecider"));
      else toast.success(t("process.run.review.wentBack", { step: backTo + 1 }));
      onSent();
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVIEW_TASK_CLOSED") {
        toast.message(t("process.run.review.superseded"));
        onCancel();
      } else if (e instanceof ApiError && e.code === "BACK_TARGET_INVALID") {
        setErr(t("process.run.review.backInvalid"));
      } else setErr(reviewErrorMessage(e, t));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        aria-label={t("process.run.review.failAs")}
        value={choice}
        onValueChange={setPick}
      >
        <Option id={`${uid}-redo`} value={REDO} label={t("process.run.review.redoThis")} />
        {steps.map((s) => {
          const names = stageNames?.(s);
          return (
            <Option
              key={s}
              id={`${uid}-${s}`}
              value={String(s)}
              label={t("process.run.review.backTo", { step: s + 1 })}
              hint={names ? t("process.run.review.backToHint", { names }) : undefined}
            />
          );
        })}
      </RadioGroup>
      {backTo !== undefined && (
        <p role="note" className="rounded-lg bg-warning-bg px-3 py-2 text-caption text-warning">
          {roundsLeft > 0
            ? t("process.run.review.backWarn", { n: roundsLeft, step: backTo + 1 })
            : t("process.run.review.backLimitNote", { max: backMax ?? PROCESS_BACK_ROUNDS_MAX })}
        </p>
      )}
      <Textarea
        aria-label={t("process.run.review.panelFeedback")}
        aria-invalid={err !== null}
        value={feedback}
        maxLength={FEEDBACK_MAX + 1}
        onChange={(e) => {
          setFeedback(e.target.value);
          setErr(null);
        }}
      />
      {over && (
        <p className="text-caption text-destructive">
          {t("process.common.validate.tooLong", { max: FEEDBACK_MAX })}
        </p>
      )}
      {err && (
        <p role="alert" className="text-caption text-destructive">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={over || mut.isPending}
          onClick={() => void send()}
        >
          {t("process.run.review.sendFail")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("process.run.review.cancel")}
        </Button>
      </div>
    </div>
  );
}

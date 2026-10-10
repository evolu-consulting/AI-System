// CHAT-AC-53 · plan-frontend §3 + plan-frontend-thread §5: thẻ kiểm Đạt / Chưa đạt.
// Trong thread (`useThreadBinding()`≠null): "Chưa đạt" đưa composer sang chế độ Góp ý. Ngoài thread: ô góp ý tại chỗ (inline).
import { FEEDBACK_MAX, type ProcessRunFullView } from "@ai/contracts/chat";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { ApiError } from "~/lib/http";
import { useThreadBinding } from "../../shared/thread/thread-binding";
import type { TaskCardProps } from "../../shared/types";
import { useReviewDecision } from "../hooks/use-review-actions";

function agentOf(view: TaskCardProps["view"], stageIdx: number, lng: string): string {
  if (view?.access !== "full") return "";
  return view.stages[stageIdx]?.executor.name[lng === "vi" ? "vi" : "en"] ?? "";
}

function reworksLeft(view: TaskCardProps["view"], stageIdx: number): number {
  if (view?.access !== "full") return 0;
  const s = (view as ProcessRunFullView).stages[stageIdx];
  return s ? Math.max(s.attempt_limit - s.attempt, 0) : 0;
}

/** `null` ⇒ việc đã đóng, thoát êm (toast "taken"); ngược lại ⇒ thông điệp lỗi để composer/ô inline hiện. */
function errorMessage(err: unknown, t: ReturnType<typeof useTranslation>["t"]): string | null {
  if (err instanceof ApiError) {
    if (err.code === "REVIEW_TASK_CLOSED") return null;
    const key = `process.common.apiError.${err.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return t("process.common.error.network");
}

export function ReviewTaskCard({ runId, task, view, onResolved }: TaskCardProps) {
  const { t, i18n } = useTranslation();
  const binding = useThreadBinding();
  const mut = useReviewDecision(runId);
  const [inlineFail, setInlineFail] = useState(false);
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const agent = agentOf(view, task.stage_idx, i18n.language);
  const left = reworksLeft(view, task.stage_idx);

  const onClosed = useCallback(() => {
    toast.message(t("process.run.review.taken"));
  }, [t]);

  const pass = useCallback(async () => {
    try {
      await mut.mutateAsync({ taskId: task.id, result: "pass" });
      onResolved?.("pass");
      toast.success(t("process.run.review.passed", { stage: task.stage_name }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "REVIEW_TASK_CLOSED") onClosed();
      else toast.error(errorMessage(err, t) ?? "");
    }
  }, [mut, task.id, task.stage_name, t, onClosed, onResolved]);

  const sendFail = useCallback(
    async (text: string) => {
      try {
        await mut.mutateAsync({ taskId: task.id, result: "fail", feedback: text });
        onResolved?.("fail");
        toast.success(t("process.run.review.sent", { agent, n: left }));
      } catch (err) {
        const msg = errorMessage(err, t);
        if (msg === null) {
          onClosed();
          return;
        }
        throw new Error(msg);
      }
    },
    [mut, task.id, t, agent, left, onClosed, onResolved],
  );

  const submitInline = useCallback(async () => {
    setInlineErr(null);
    try {
      await sendFail(feedback.trim());
      setInlineFail(false);
      setFeedback("");
    } catch (err) {
      setInlineErr(err instanceof Error ? err.message : "");
    }
  }, [sendFail, feedback]);

  const startFail = useCallback(() => {
    if (binding) {
      binding.begin({ kind: "feedback", taskId: task.id, agent, submit: sendFail });
    } else {
      setInlineFail(true);
    }
  }, [binding, task.id, agent, sendFail]);

  if (!task.can_act) return null;
  const over = feedback.length > FEEDBACK_MAX;
  const canSubmit = feedback.trim().length > 0 && !over && !mut.isPending;
  return (
    <section
      aria-label={t("process.run.review.region", { stage: task.stage_name })}
      className="flex flex-col gap-2 rounded-xl border border-warning-solid/40 bg-card p-3"
    >
      <p className="text-sm font-medium">{t("process.run.review.title", { agent })}</p>
      {!inlineFail ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={mut.isPending} onClick={() => void pass()}>
            {t("process.common.result.pass")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={startFail}>
            {t("process.common.result.fail")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            aria-label={t("process.run.review.feedback", { agent })}
            value={feedback}
            maxLength={FEEDBACK_MAX + 1}
            onChange={(e) => setFeedback(e.target.value)}
          />
          {over && (
            <p className="text-caption text-destructive">
              {t("process.common.validate.tooLong", { max: FEEDBACK_MAX })}
            </p>
          )}
          {inlineErr && <p className="text-caption text-destructive">{inlineErr}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit}
              onClick={() => void submitInline()}
            >
              {t("process.run.review.submit")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setInlineFail(false);
                setFeedback("");
              }}
            >
              {t("process.run.review.cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

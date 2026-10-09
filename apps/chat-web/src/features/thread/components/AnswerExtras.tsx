// CHAT-AC-08..13, CHAT-AC-24..27 · phần dưới câu trả lời: bước, hỏi lại, lỗi, đã dừng. Props `{ answer: AnswerView }` ổn định.
// Gửi lại dùng `answer.context` (convId/flowId/nội dung gốc); thiếu → không có nút gửi.
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AskCard } from "~/features/answer/components/AskCard";
import { CancelledNote } from "~/features/answer/components/CancelledNote";
import { ErrorCard } from "~/features/answer/components/ErrorCard";
import { StepList } from "~/features/answer/components/StepList";
import { answererName } from "~/features/answer/lib/step-label";
import { useSend } from "~/features/run/hooks/use-send";
import type { AnswerContext, AnswerView } from "../lib/thread-logic";

function useResend(ctx: AnswerContext | null | undefined) {
  const send = useSend();
  const inFlow = useCallback(
    (flowId: string, ctxv: AnswerContext, content: string) =>
      void send.sendInFlow(
        ctxv.convId,
        { id: flowId, last_active_at: new Date().toISOString() },
        content,
      ),
    [send],
  );
  const rerun = useCallback(() => {
    if (!ctx) return;
    if (ctx.origin === "flow" && ctx.flowId) inFlow(ctx.flowId, ctx, ctx.content);
    else void send.sendMain(ctx.convId, ctx.content);
  }, [ctx, send, inFlow]);
  const pick = useCallback(
    (choice: string) => {
      if (ctx?.flowId) inFlow(ctx.flowId, ctx, choice);
    },
    [ctx, inFlow],
  );
  return { rerun: ctx ? rerun : undefined, pick: ctx?.flowId ? pick : undefined };
}

export function AnswerExtras({ answer }: { answer: AnswerView }) {
  const { ask, error, cancelled, steps, context, askAnswered, streaming } = answer;
  const { rerun, pick } = useResend(context);
  const { t } = useTranslation();
  const name = answererName(answer);
  const stopped = cancelled || error?.code === "CANCELLED";
  return (
    <>
      {steps && steps.length > 0 && <StepList steps={steps} streaming={streaming} />}
      {ask && (
        <AskCard
          question={ask.question}
          choices={ask.choices}
          answered={askAnswered ?? false}
          onPick={pick}
          title={name ? t("roomAgent.askTitle", { agent: name }) : undefined}
        />
      )}
      {error && !stopped && <ErrorCard code={error.code} runId={error.runId} onRetry={rerun} />}
      {stopped && <CancelledNote onRerun={rerun} />}
    </>
  );
}

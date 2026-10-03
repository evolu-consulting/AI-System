// CHAT-AC-05, CHAT-AC-06 · khối flow ở luồng chính: câu hỏi đầu (phải) + Consultant + câu trả lời đầu (stream ngay trong khối) + footer.
import { useTranslation } from "react-i18next";
import { ConsultantAvatar } from "~/components/shared/ConsultantAvatar";
import { AnswerBody } from "~/features/answer/components/AnswerBody";
import { ColdResumeNote } from "~/features/answer/components/ColdResumeNote";
import { cn } from "~/lib/utils";
import type { AnswerView } from "../lib/thread-logic";
import { AnswerExtras } from "./AnswerExtras";
import { FlowFooter, type FlowFooterProps } from "./FlowFooter";

export type FlowBlockProps = {
  title: string;
  flowId: string | null;
  /** Run đang chạy trong khối (`data-run-id` cho e2e đối chiếu cancel). */
  runId: string | null;
  question: string;
  /** null → chưa có câu trả lời. */
  answer: AnswerView | null;
  footer: FlowFooterProps;
};

function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary align-[-3px]"
    />
  );
}

/** Thân câu trả lời (chờ / cold / stream + con trỏ) — dùng chung cho khối flow và khung flow (F10). */
export function Answer({ answer }: { answer: AnswerView }) {
  if (answer.waiting) {
    return answer.cold ? <ColdResumeNote /> : <StreamingCursor />;
  }
  return (
    <div className="leading-relaxed" aria-busy={answer.streaming || undefined}>
      {answer.text !== "" && <AnswerBody content={answer.text} streaming={answer.streaming} />}
      {answer.streaming && <StreamingCursor />}
    </div>
  );
}

export function FlowBlock({ title, flowId, runId, question, answer, footer }: FlowBlockProps) {
  const { t } = useTranslation();
  const live = answer?.streaming ?? false;
  return (
    <article
      aria-label={t("flow.label", { title })}
      data-flow-id={flowId ?? undefined}
      data-run-id={runId ?? undefined}
      className={cn(
        "flex flex-col gap-3 rounded-[14px] border bg-card p-4",
        live || footer.openHere ? "border-primary/40" : "border-border",
      )}
    >
      <div className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-xl bg-row-divider px-3.5 py-2.5 leading-normal">
        {question}
      </div>
      {answer && (
        <>
          <ConsultantAvatar />
          <Answer answer={answer} />
          <AnswerExtras answer={answer} />
        </>
      )}
      <FlowFooter {...footer} />
    </article>
  );
}

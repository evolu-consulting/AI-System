// CHAT-AC-05, CHAT-AC-06 · khối flow ở luồng chính: câu hỏi đầu (phải) + Consultant + câu trả lời đầu (stream ngay trong khối) + footer.
import type { AttachmentRef } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { ConsultantAvatar } from "~/components/shared/ConsultantAvatar";
import { AnswerBody } from "~/features/answer/components/AnswerBody";
import { ColdResumeNote } from "~/features/answer/components/ColdResumeNote";
import { answererName } from "~/features/answer/lib/step-label";
import { AttachmentList } from "~/features/attachments/components/AttachmentList";
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
  /** HUB-FR-44 · file người dùng gửi kèm câu hỏi. */
  questionAttachments?: AttachmentRef[];
  /** null → chưa có câu trả lời. */
  answer: AnswerView | null;
  footer: FlowFooterProps;
};

function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary align-[-3px] motion-reduce:animate-none"
    />
  );
}

/**
 * Thân câu trả lời (chờ / cold / stream) — dùng chung cho khối flow và khung flow (F10).
 * Chờ chữ đầu: con trỏ chỉ khi chưa có bước nào (danh sách bước đã báo tiến độ — CR-054). Đang stream: con trỏ
 * cuối dòng do `Markdown` vẽ (không thêm cái thứ hai ở đây).
 */
export function Answer({ answer }: { answer: AnswerView }) {
  if (answer.waiting) {
    if (answer.cold) return <ColdResumeNote />;
    return answer.steps?.length ? null : <StreamingCursor />;
  }
  // a11y (plan-frontend §9): chữ đang stream ẩn khỏi trình đọc màn hình; xong run thì gắn node mới
  // (đổi `key`) để vùng `role=log` (aria-relevant=additions) đọc bản đầy đủ một lần.
  return (
    <div
      key={answer.streaming ? "streaming" : "done"}
      className="leading-relaxed"
      aria-hidden={answer.streaming || undefined}
      aria-busy={answer.streaming || undefined}
    >
      {answer.text !== "" && <AnswerBody content={answer.text} streaming={answer.streaming} />}
      <AttachmentList items={answer.attachments} />
    </div>
  );
}

export function FlowBlock({
  title,
  flowId,
  runId,
  question,
  questionAttachments,
  answer,
  footer,
}: FlowBlockProps) {
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
      <AttachmentList items={questionAttachments} />
      {answer && (
        <>
          <ConsultantAvatar name={answererName(answer)} />
          <Answer answer={answer} />
          <AnswerExtras answer={answer} />
        </>
      )}
      <FlowFooter {...footer} />
    </article>
  );
}

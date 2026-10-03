// CHAT-AC-05, CHAT-AC-06, CHAT-AC-20 · ghép flow (E10 `preview`) với run của nó → props cho FlowBlock.
// Gắn lại run `active_run_id` (F5); run xong + E10 đã có câu trả lời → `dismiss` (không nháy).
import { deriveTitle, type Flow } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRunByKey, useRunStream } from "~/features/run/hooks/use-run-stream";
import { useSend } from "~/features/run/hooks/use-send";
import { isRunActive, type RunState } from "~/features/run/lib/reducer";
import type { FlowBlockProps } from "../components/FlowBlock";
import { answerFromMessage, answerFromRun, relativeTime, shouldDismiss } from "../lib/thread-logic";

/** Run là câu trả lời đầu của flow (hiện trong khối) hay là tin sau (chỉ đồng bộ footer). */
function isFirstAnswerRun(run: RunState, flow: Flow): boolean {
  const { question, answer } = flow.preview;
  return answer === null || answer.id === run.answerId || run.messageId === question.id;
}

export function useFlowBlock(convId: string, flow: Flow, openFlowId?: string): FlowBlockProps {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { dismiss } = useSend();
  const first = flow.preview.answer === null;
  const run = useRunStream({
    convId,
    flowId: flow.id,
    activeRunId: flow.active_run_id,
    origin: first ? "main" : "flow",
  });
  useEffect(() => {
    if (run && shouldDismiss(run, flow)) dismiss(run.key);
  }, [run, flow, dismiss]);

  const inBlock = run !== undefined && isFirstAnswerRun(run, flow);
  const saved = flow.preview.answer;
  const savedExtra = {
    context: {
      convId,
      flowId: flow.id,
      content: flow.preview.question.content,
      origin: "main" as const,
    },
    askAnswered: flow.message_count > 2,
  };
  const answer = inBlock ? answerFromRun(run) : saved ? answerFromMessage(saved, savedExtra) : null;
  const live = run !== undefined && isRunActive(run);
  return {
    title: flow.title,
    flowId: flow.id,
    runId: live ? run.runId : null,
    question: flow.preview.question.content,
    answer,
    footer: {
      copyValue: answer?.streaming ? "" : (answer?.text ?? ""),
      messageCount: flow.message_count,
      timeLabel: relativeTime(flow.last_active_at, Date.now(), i18n.language),
      openHere: openFlowId === flow.id,
      busy: live && !inBlock,
      onReply: () =>
        void navigate({ to: "/c/$id", params: { id: convId }, search: { flow: flow.id } }),
    },
  };
}

/** Khối tạm cho run vừa gửi từ ô chính mà E10 chưa có flow của nó. */
export function usePendingBlock(key: string): FlowBlockProps | null {
  const run = useRunByKey(key);
  if (!run) return null;
  const answer = answerFromRun(run);
  return {
    title: deriveTitle(run.request.content),
    flowId: run.flowId,
    runId: isRunActive(run) ? run.runId : null,
    question: run.request.content,
    answer,
    footer: {
      copyValue: answer.streaming ? "" : answer.text,
      messageCount: 0,
      timeLabel: null,
      openHere: false,
      busy: false,
    },
  };
}

// CHAT-AC-57 · HUB-FR-110 · plan-frontend §4 + thread §5: logic của thẻ hỏi lại — gửi câu trả lời, chip, đưa composer thread sang chế độ Trả lời.
import type { TaskDetail } from "@ai/contracts/chat";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSourceChips } from "../../inputs/api";
import { type ThreadBinding, useThreadBinding } from "../../shared/thread/thread-binding";
import {
  askErrorKey,
  askMode,
  chipDescriptions,
  hasSourceKeyLike,
  validateAnswer,
} from "../lib/ask-rules";
import { askToast } from "../lib/ask-toast";
import { codeOf, isClosedError, useAnswerTask } from "./use-ask-actions";

type Opts = {
  runId: string;
  task: TaskDetail;
  agent: string;
  /** Chip gộp nhiều câu ở chế độ inline: chèn vào ô. */
  onInsert(choice: string): void;
};

/** Thẻ biến mất (đã trả lời/đóng) khi composer còn ràng với việc này => trả composer về Thường. */
function useUnbindOnClose(binding: ThreadBinding | null, taskId: string) {
  const ref = useRef(binding);
  ref.current = binding;
  useEffect(
    () => () => {
      const b = ref.current;
      if (b?.active?.taskId === taskId) b.cancel();
    },
    [taskId],
  );
}

export function useAskCard({ runId, task, agent, onInsert }: Opts) {
  const { t } = useTranslation();
  const binding = useThreadBinding();
  const answer = useAnswerTask(runId, task.id);
  useUnbindOnClose(binding, task.id);
  // P-b (FS-10): mô tả chip nguồn — chỉ gọi khi có lựa chọn dạng ký hiệu nguồn và thẻ còn mở.
  const choices = task.choices ?? [];
  const chips = useSourceChips(task.status === "open" && hasSourceKeyLike(choices));
  const descriptions = useMemo(() => chipDescriptions(choices, chips.data), [choices, chips.data]);

  /** Gửi câu trả lời; reject (có thông điệp đã dịch) ⇒ nơi gọi hiện lỗi và giữ chữ. */
  const send = useCallback(
    async (text: string, choice?: string): Promise<void> => {
      const bad = validateAnswer(text);
      if (bad) {
        throw new Error(
          t(`process.common.validate.${bad.key}`, { max: "max" in bad ? bad.max : undefined }),
        );
      }
      try {
        await answer.mutateAsync({ answer: text.trim(), ...(choice && { choice }) });
        askToast(t("process.ask.toast.answered"));
      } catch (e) {
        if (isClosedError(e)) return askToast(t("process.ask.err.closed"));
        throw new Error(t(askErrorKey(codeOf(e))));
      }
    },
    [answer, t],
  );

  const begin = useCallback(() => {
    if (binding?.active?.taskId !== task.id) {
      binding?.begin({ kind: "answer", taskId: task.id, agent, submit: (text) => send(text) });
    }
  }, [binding, task.id, agent, send]);

  /** Chip: một câu ⇒ gửi ngay; gộp nhiều câu ⇒ điền vào ô (composer thread hoặc ô inline). */
  const pick = useCallback(
    async (choice: string): Promise<void> => {
      if (askMode(task.question ?? "") === "single") return send(choice, choice);
      if (!binding) return onInsert(choice);
      begin();
      setTimeout(() => binding.fill(choice), 0);
    },
    [binding, begin, onInsert, send, task.question],
  );

  return { binding, send, begin, pick, descriptions, pending: answer.isPending };
}

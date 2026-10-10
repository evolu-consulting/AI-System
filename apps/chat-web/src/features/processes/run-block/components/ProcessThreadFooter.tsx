// CHAT-AC-52/53 · plan-frontend-thread §5 · F4a seam: composer thread (Thường / Góp ý / Trả lời) qua `useThreadBinding()`.
// Thường = người↔người (`@agent` ⇒ 422 PROCESS_THREAD_NO_AGENT, chữ giữ). Ràng task: thẻ gọi `begin({submit})`, footer chỉ
// gọi `binding.submit(text)`; reject ⇒ giữ chữ + hiện `Error.message`. `registerFill` để chip (PF2) điền vào ô.
import { ANSWER_MAX, CHAT_CONTENT_MAX, FEEDBACK_MAX, type RoomActiveRun } from "@ai/contracts/chat";
import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Composer } from "~/features/composer/components/Composer";
import type { ComposerHandle, SubmitResult } from "~/features/composer/components/composer-types";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import { useFlowSend } from "~/features/rooms/hooks/use-room-flow";
import { useThreadBinding } from "../../shared/thread/thread-binding";

export type ProcessThreadFooterProps = {
  roomId: string;
  flowId: string;
  myId: string;
  activeRuns: readonly RoomActiveRun[] | undefined;
  composerRef?: Ref<ComposerHandle>;
  mobile?: boolean;
};

export function ProcessThreadFooter(p: ProcessThreadFooterProps) {
  const { t } = useTranslation();
  const binding = useThreadBinding();
  const active = binding?.active ?? null;
  const cref = useRef<ComposerHandle | null>(null);
  const [modeErr, setModeErr] = useState<string | null>(null);
  const plainSend = useFlowSend({
    roomId: p.roomId,
    flowId: p.flowId,
    myId: p.myId,
    activeRuns: p.activeRuns,
  });
  const plainDraftKey = useDraftKey(p.roomId, p.flowId);

  // F4a seam: footer đăng ký hàm điền chữ để chip (AskTaskCard PF2) gọi `fill()`.
  const setRef = useCallback(
    (h: ComposerHandle | null) => {
      cref.current = h;
      if (typeof p.composerRef === "function") p.composerRef(h);
      else if (p.composerRef) (p.composerRef as { current: ComposerHandle | null }).current = h;
    },
    [p.composerRef],
  );
  useEffect(() => {
    if (!binding) return;
    binding.registerFill((text) => cref.current?.fill(text));
    return () => binding.registerFill(null);
  }, [binding]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: xoá lỗi khi đổi chế độ/task.
  useEffect(() => setModeErr(null), [active?.taskId, active?.kind]);

  const submitMode = useCallback(
    async (text: string): Promise<SubmitResult> => {
      setModeErr(null);
      try {
        await binding?.submit(text);
        return true;
      } catch (err) {
        setModeErr(err instanceof Error ? err.message : t("process.common.error.network"));
        return false;
      }
    },
    [binding, t],
  );

  if (active) {
    const feedback = active.kind === "feedback";
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-warning-bg px-3 py-1.5 text-caption text-warning">
          <span>
            {feedback
              ? t("process.thread.mode.feedback", { agent: active.agent })
              : t("process.thread.mode.answer", { agent: active.agent })}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => binding?.cancel()}>
            {t("process.thread.mode.cancel")}
          </Button>
        </div>
        <Composer
          key={`${active.kind}:${active.taskId}`}
          ref={setRef}
          variant="flow"
          draftKey={`${plainDraftKey}:${feedback ? "fb" : "ans"}:${active.taskId}`}
          autoFocus={!p.mobile}
          menus={false}
          attachments={false}
          inputLabel={
            feedback
              ? t("process.run.review.feedback", { agent: active.agent })
              : t("process.ask.answer")
          }
          sendLabel={feedback ? t("process.run.review.submit") : t("process.ask.send")}
          maxChars={feedback ? FEEDBACK_MAX : ANSWER_MAX}
          onSubmit={submitMode}
        />
        {modeErr && <p className="px-1 text-caption text-destructive">{modeErr}</p>}
      </div>
    );
  }
  return (
    <Composer
      ref={setRef}
      variant="flow"
      draftKey={plainDraftKey}
      autoFocus={!p.mobile}
      menus={false}
      attachments={false}
      // Thread quy trình: nút gửi là "Gửi" (plan-frontend-e2e §1), không phải "Gửi trong flow" mặc định của variant flow.
      sendLabel={t("composer.send")}
      maxChars={CHAT_CONTENT_MAX}
      hint={t("process.thread.hint")}
      onSubmit={plainSend}
    />
  );
}

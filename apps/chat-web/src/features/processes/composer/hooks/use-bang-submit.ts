// CHAT-AC-52 · chặn `!key …` ở composer Hỏi AI (FD4): `POST /process-runs` thay vì đường gửi run thường. Phòng đi đường gửi cũ (Hub xử lý).
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SubmitResult } from "~/features/composer/hooks/use-send-error";
import { isComposerError } from "~/features/composer/lib/send-error";
import { ApiError, type ApiErrorCode } from "~/lib/http";
import { startProcess } from "../api";
import { classifyBang } from "../lib/bang";

export type BangOrigin =
  | { kind: "room"; roomId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "none" };

export type BangSubmit = {
  /** `null` = không phải `!key` ⇒ để đường gửi thường xử lý. `attachmentIds` không rỗng ⇒ chặn (quy trình chưa nhận tệp). */
  intercept(text: string, attachmentIds?: readonly string[]): Promise<SubmitResult> | null;
};

/** Mã lỗi phía client (không phải của Hub): có tệp đính kèm; `send-error.ts` đổi thành câu `process.composer.error.noAttach`. */
export const PROCESS_NO_ATTACH_CODE = "PROCESS_ATTACH_UNSUPPORTED";

const PASS: BangSubmit = { intercept: () => null };

/** Hỏi AI: `origin` conversation / none. Cờ off ⇒ `enabled=false` ⇒ `!` là chữ thường (đường cũ). */
export function useBangSubmit(origin: BangOrigin, enabled: boolean): BangSubmit {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const kind = origin.kind;
  const convId = origin.kind === "conversation" ? origin.conversationId : null;

  const run = useCallback(
    async (key: string, input: string): Promise<SubmitResult> => {
      try {
        const created = await startProcess({
          process_key: key,
          input,
          origin: convId ? { kind: "conversation", conversation_id: convId } : { kind: "none" },
        });
        const open = () => void router.navigate({ to: "/runs/$id", params: { id: created.id } });
        void queryClient.invalidateQueries({ queryKey: ["process", "runs"] });
        if (convId) {
          toast.success(t("process.composer.toast.started", { name: created.process.name }), {
            position: "top-right",
            action: { label: t("process.composer.toast.open"), onClick: open },
          });
        } else open();
        return true;
      } catch (err) {
        if (err instanceof ApiError && isComposerError(err)) return { ok: false, error: err };
        toast.error(t("toast.sendFailed"));
        return false;
      }
    },
    [convId, queryClient, router, t],
  );

  return useMemo<BangSubmit>(() => {
    if (!enabled || kind === "room") return PASS;
    return {
      intercept(text, attachmentIds) {
        const c = classifyBang(text);
        if (c.kind !== "run") return null;
        if (attachmentIds && attachmentIds.length > 0) {
          const err = new ApiError(400, PROCESS_NO_ATTACH_CODE as ApiErrorCode, "attachments");
          return Promise.resolve({ ok: false, error: err });
        }
        return run(c.key, c.input);
      },
    };
  }, [enabled, kind, run]);
}

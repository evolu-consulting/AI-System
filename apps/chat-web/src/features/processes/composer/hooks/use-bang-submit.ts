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
import { disarmProcessStart, isProcessStartArmed } from "../lib/bang-state";

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

/** `POST /process-runs` cho một origin; phòng (▶)/Hỏi AI ⇒ toast có nút Mở, không origin ⇒ mở ngay. */
function useRunStarter(roomId: string | null, convId: string | null) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    async (key: string, input: string): Promise<SubmitResult> => {
      const origin = roomId
        ? ({ kind: "room", room_id: roomId } as const)
        : convId
          ? ({ kind: "conversation", conversation_id: convId } as const)
          : ({ kind: "none" } as const);
      try {
        const created = await startProcess({ process_key: key, input, origin });
        const open = () => void router.navigate({ to: "/runs/$id", params: { id: created.id } });
        void queryClient.invalidateQueries({ queryKey: ["process", "runs"] });
        if (roomId || convId)
          toast.success(t("process.composer.toast.started", { name: created.process.name }), {
            position: "top-right",
            action: { label: t("process.composer.toast.open"), onClick: open },
          });
        else open();
        return true;
      } catch (err) {
        if (err instanceof ApiError && isComposerError(err)) return { ok: false, error: err };
        toast.error(t("toast.sendFailed"));
        return false;
      }
    },
    [convId, roomId, queryClient, router, t],
  );
}

/** `!key` ở composer: Hỏi AI (origin conversation/none) chặn luôn; phòng chỉ chặn khi do nút "▶ Quy trình" (đã arm, T1). */
export function useBangSubmit(origin: BangOrigin, enabled: boolean): BangSubmit {
  const kind = origin.kind;
  const convId = origin.kind === "conversation" ? origin.conversationId : null;
  const roomId = origin.kind === "room" ? origin.roomId : null;
  const run = useRunStarter(roomId, convId);

  return useMemo<BangSubmit>(() => {
    if (!enabled) return PASS;
    return {
      intercept(text, attachmentIds) {
        const c = classifyBang(text);
        if (c.kind !== "run") return null;
        // Phòng: chỉ chặn khi do nút "▶ Quy trình" (đã arm); `!key` gõ tay ⇒ đường gửi thường ⇒ Hub đăng tin gọi (T1).
        if (kind === "room") {
          if (!isProcessStartArmed()) return null;
          disarmProcessStart();
        }
        if (attachmentIds && attachmentIds.length > 0) {
          const err = new ApiError(400, PROCESS_NO_ATTACH_CODE as ApiErrorCode, "attachments");
          return Promise.resolve({ ok: false, error: err });
        }
        return run(c.key, c.input);
      },
    };
  }, [enabled, kind, run]);
}

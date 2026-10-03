// CHAT-AC-05 · nháp theo (hội thoại, flow) trong localStorage: debounce 300 ms, xoá khi gửi thành công.
import { useEffect, useMemo } from "react";
import { session } from "~/lib/auth/session";
import { useSession } from "~/lib/auth/use-session";
import { readLocal, removeLocal, writeLocal } from "~/lib/storage";
import { DRAFT_DEBOUNCE_MS, draftKey } from "../lib/composer-logic";
import { createDraftSaver } from "../lib/draft-saver";

/** Khoá nháp của user đang đăng nhập cho (hội thoại, flow). */
export function useDraftKey(convId: string | null, flowId: string | null): string {
  const userId = useSession((s) => s.me?.id ?? null);
  return draftKey(userId, convId, flowId);
}

export function readDraft(key: string): string {
  return readLocal(key) ?? "";
}

export function useDraftSaver(key: string) {
  const saver = useMemo(
    () =>
      createDraftSaver(key, DRAFT_DEBOUNCE_MS, {
        write: writeLocal,
        remove: removeLocal,
        canWrite: () => session.getState().status === "authed",
        setTimer: (cb, ms) => setTimeout(cb, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      }),
    [key],
  );
  useEffect(() => saver.flush, [saver]);
  return { save: saver.save, clear: saver.clear };
}

// CHAT-AC-05 · nháp theo (hội thoại, flow) trong localStorage: debounce 300 ms, xoá khi gửi thành công.
import { useCallback, useEffect, useRef } from "react";
import { useSession } from "~/lib/auth/use-session";
import { readLocal, removeLocal, writeLocal } from "~/lib/storage";
import { DRAFT_DEBOUNCE_MS, draftKey } from "../lib/composer-logic";

/** Khoá nháp của user đang đăng nhập cho (hội thoại, flow). */
export function useDraftKey(convId: string | null, flowId: string | null): string {
  const userId = useSession((s) => s.me?.id ?? null);
  return draftKey(userId, convId, flowId);
}

export function readDraft(key: string): string {
  return readLocal(key) ?? "";
}

export function useDraftSaver(key: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    if (pending.current === "") removeLocal(key);
    else writeLocal(key, pending.current);
    pending.current = null;
  }, [key]);
  const save = useCallback(
    (text: string) => {
      pending.current = text;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
    },
    [flush],
  );
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    removeLocal(key);
  }, [key]);
  useEffect(() => flush, [flush]);
  return { save, clear };
}

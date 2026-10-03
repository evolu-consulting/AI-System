// CHAT-AC-05 · nháp theo (hội thoại, flow) trong localStorage: debounce 300 ms, xoá khi gửi thành công.
import { useCallback, useEffect, useRef } from "react";
import { readLocal, removeLocal, writeLocal } from "~/lib/storage";
import { DRAFT_DEBOUNCE_MS } from "../lib/composer-logic";

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

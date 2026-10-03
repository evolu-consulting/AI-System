// CHAT-AC-18, CHAT-AC-21 · phím tắt toàn app: Ctrl/Cmd+Shift+O → hội thoại mới; Ctrl/Cmd+K → ô tìm.
import { useEffect } from "react";

type Handlers = { onNewChat: () => void; onSearch: () => void };

/** Trả hành động ứng với phím, hoặc null. Thuần để test. */
export function shortcutOf(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "new" | "search" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "o" && e.shiftKey) return "new";
  if (k === "k" && !e.shiftKey) return "search";
  return null;
}

export function useShortcuts({ onNewChat, onSearch }: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutOf(e);
      if (!action) return;
      e.preventDefault();
      if (action === "new") onNewChat();
      else onSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat, onSearch]);
}

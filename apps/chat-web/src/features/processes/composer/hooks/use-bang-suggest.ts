// CHAT-AC-51 · trạng thái menu `!` (mở/lọc/chọn) cùng dạng `useAgentSuggest`; nạp lười `GET /processes` lần gõ `!` đầu tiên.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Suggest, SuggestStatus } from "~/features/composer/hooks/use-suggest";
import { processKeys } from "../../shared/keys";
import { useProcessMenu } from "../api";
import { bangQuery, fillBang, filterProcesses, type ProcessMatch } from "../lib/bang";
import { publishBangState } from "../lib/bang-state";

export type BangSuggest = Suggest<ProcessMatch>;

function statusOf(
  isError: boolean,
  items: readonly unknown[] | undefined,
  matches: number,
): SuggestStatus {
  if (isError) return "error";
  if (!items) return "loading";
  if (items.length === 0) return "empty";
  return matches === 0 ? "nomatch" : "ready";
}

/** Chọn/điều hướng dòng menu (dùng `latest` ref để phím liên tiếp không đọc nhầm closure cũ). Tách khỏi `useBangSuggest` cho ≤ 50 dòng (RV1: F2 soát). */
function useBangSelection(matches: readonly ProcessMatch[], q: string | null, text: string) {
  const [sel, setSel] = useState({ q: "", i: 0 });
  const idx = sel.q === (q ?? "") ? sel.i : 0; // đổi chữ lọc ⇒ về dòng đầu
  const active = matches.length === 0 ? 0 : Math.min(idx, matches.length - 1);
  const latest = useRef({ active, count: matches.length, q: q ?? "" });
  latest.current = { active, count: matches.length, q: q ?? "" };
  const move = useCallback((delta: 1 | -1) => {
    const { active: cur, count, q: curQ } = latest.current;
    if (count === 0) return;
    const i = (cur + delta + count) % count;
    latest.current.active = i;
    setSel({ q: curQ, i });
  }, []);
  const pick = useCallback(
    (_current: string, index = latest.current.active) => {
      const m = matches[index];
      return m ? fillBang(text, m.item.key) : null;
    },
    [matches, text],
  );
  return { active, move, pick };
}

/** `enabled=false` (cờ off / menu tắt) ⇒ không gọi `GET /processes`, không mở. */
export function useBangSuggest(text: string, caret: number, enabled: boolean): BangSuggest {
  const q = enabled ? bangQuery(text, caret) : null;
  const queryClient = useQueryClient();
  const [wanted, setWanted] = useState(false);
  if (q !== null && !wanted) setWanted(true);
  // Mở phòng/trang ⇒ đánh dấu cũ một lần (không refetch tới khi menu được dùng).
  useEffect(() => {
    if (enabled) void queryClient.invalidateQueries({ queryKey: processKeys.catalog });
  }, [enabled, queryClient]);
  const menu = useProcessMenu(enabled && (wanted || q !== null));
  const items = menu.data?.items;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const open = q !== null && dismissedFor !== text;
  const matches = useMemo(() => (items && q !== null ? filterProcesses(items, q) : []), [items, q]);
  const { active, move, pick } = useBangSelection(matches, q, text);
  const refetch = menu.refetch;
  const dismiss = useCallback(() => setDismissedFor(text), [text]);

  // Nút "Quy trình": mở ⇒ đóng; đang bị Esc đóng mà vẫn còn `!…` ⇒ mở lại; chưa có `!` ⇒ chèn.
  const toggle = useCallback(
    (insert: (v: string) => void) => {
      if (q === null) insert(text.trim() === "" ? "!" : `!${text}`);
      else if (dismissedFor === text) setDismissedFor(null);
      else setDismissedFor(text);
    },
    [q, text, dismissedFor],
  );
  useEffect(() => {
    if (!enabled) return;
    publishBangState({ open, toggle });
    return () => publishBangState(null);
  }, [enabled, open, toggle]);

  return {
    open,
    q: q ?? "",
    status: statusOf(menu.isError, items, matches.length),
    matches,
    active,
    retry: () => void refetch(),
    move,
    dismiss,
    pick,
  };
}

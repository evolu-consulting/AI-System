// HUB-FR-10 · trạng thái menu `/` của composer: mở/đóng theo chữ + con trỏ, lọc, chỉ mục chọn, nạp lười `GET /commands`.
import { useCallback, useMemo, useRef, useState } from "react";
import { useCommandMenu } from "~/features/commands/api";
import {
  type CommandMatch,
  fillCommand,
  filterCommands,
  slashQuery,
} from "~/features/commands/lib/slash";

export type SuggestStatus = "loading" | "error" | "empty" | "nomatch" | "ready";

export type CommandSuggest = {
  open: boolean;
  q: string;
  status: SuggestStatus;
  matches: CommandMatch[];
  active: number;
  retry(): void;
  /** ↑↓ vòng quanh. */
  move(delta: 1 | -1): void;
  /** Esc: đóng tới khi chữ đổi. */
  dismiss(): void;
  /** Điền lệnh thứ `index` (mặc định dòng đang chọn); `null` nếu không có dòng. */
  pick(text: string, index?: number): { text: string; caret: number } | null;
};

export function useCommandSuggest(text: string, caret: number): CommandSuggest {
  const q = slashQuery(text, caret);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const [, rerender] = useState(0);
  // Chỉ mục chọn nằm trong ref (đồng bộ): hai phím liên tiếp không đọc nhầm closure cũ.
  const sel = useRef({ q: "", i: 0 });
  const open = q !== null && dismissedFor !== text;
  if (q !== null && !wanted) setWanted(true); // nạp lười: một lần, giữ cache sau đó
  const idx = sel.current.q === q ? sel.current.i : 0; // đổi chữ lọc → về dòng đầu

  const menu = useCommandMenu(wanted || q !== null);
  const items = menu.data?.items;
  const matches = useMemo(() => (items && q !== null ? filterCommands(items, q) : []), [items, q]);

  let status: SuggestStatus = "ready";
  if (menu.isError) status = "error";
  else if (!items) status = "loading";
  else if (items.length === 0) status = "empty";
  else if (matches.length === 0) status = "nomatch";

  const active = matches.length === 0 ? 0 : Math.min(idx, matches.length - 1);
  const latest = useRef({ active, count: matches.length, q: q ?? "" });
  latest.current = { active, count: matches.length, q: q ?? "" };
  const move = useCallback((delta: 1 | -1) => {
    const { active: cur, count, q: curQ } = latest.current;
    if (count === 0) return;
    const i = (cur + delta + count) % count;
    sel.current = { q: curQ, i };
    latest.current.active = i;
    rerender((n) => n + 1);
  }, []);
  const pick = useCallback(
    (current: string, index = latest.current.active) => {
      const m = matches[index];
      return m ? fillCommand(current, m.item.name) : null;
    },
    [matches],
  );
  const { refetch } = menu;
  return {
    open,
    q: q ?? "",
    status,
    matches,
    active,
    retry: () => void refetch(),
    move,
    dismiss: () => setDismissedFor(text),
    pick,
  };
}

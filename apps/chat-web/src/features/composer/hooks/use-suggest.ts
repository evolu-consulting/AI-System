// HUB-FR-10/91 · trạng thái menu `/` và `@` của composer: mở/đóng theo chữ + con trỏ, lọc, chỉ mục chọn, nạp lười.
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentMenu } from "~/features/agents/api";
import {
  type AgentMatch,
  fillAgent,
  filterAgents,
  mentionQuery,
} from "~/features/agents/lib/mention";
import { useCommandMenu } from "~/features/commands/api";
import {
  type CommandMatch,
  fillCommand,
  filterCommands,
  slashQuery,
} from "~/features/commands/lib/slash";
import { optionId } from "../components/SuggestMenu";
import { AGENT_MENU_ID, COMMAND_MENU_ID } from "../lib/menu-ids";

export type SuggestStatus = "loading" | "error" | "empty" | "nomatch" | "ready";

export type Suggest<M> = {
  open: boolean;
  q: string;
  status: SuggestStatus;
  matches: M[];
  active: number;
  retry(): void;
  /** ↑↓ vòng quanh. */
  move(delta: 1 | -1): void;
  /** Esc: đóng tới khi chữ đổi. */
  dismiss(): void;
  /** Điền dòng thứ `index` (mặc định dòng đang chọn); `null` nếu không có dòng. */
  pick(text: string, index?: number): { text: string; caret: number } | null;
};
export type CommandSuggest = Suggest<CommandMatch>;
export type AgentSuggest = Suggest<AgentMatch>;

type MenuQuery<I> = { items: readonly I[] | undefined; isError: boolean; refetch(): unknown };

function useSuggestCore<I, M>(opts: {
  text: string;
  caret: number;
  q: string | null;
  menu: MenuQuery<I>;
  filter(items: readonly I[], q: string): M[];
  fill(text: string, caret: number, m: M): { text: string; caret: number };
}): Suggest<M> {
  const { text, caret, q, menu, filter, fill } = opts;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [, rerender] = useState(0);
  // Chỉ mục chọn nằm trong ref (đồng bộ): hai phím liên tiếp không đọc nhầm closure cũ.
  const sel = useRef({ q: "", i: 0 });
  const open = q !== null && dismissedFor !== text;
  const idx = sel.current.q === q ? sel.current.i : 0; // đổi chữ lọc → về dòng đầu

  const items = menu.items;
  const matches = useMemo(() => (items && q !== null ? filter(items, q) : []), [items, q, filter]);

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
      return m ? fill(current, caret, m) : null;
    },
    [matches, fill, caret],
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

const fillCmd = (t: string, _c: number, m: CommandMatch) => fillCommand(t, m.item.name);
const filterCmd = (items: Parameters<typeof filterCommands>[0], q: string) =>
  filterCommands(items, q);

export function useCommandSuggest(text: string, caret: number): CommandSuggest {
  const q = slashQuery(text, caret);
  const [wanted, setWanted] = useState(false);
  if (q !== null && !wanted) setWanted(true); // nạp lười: một lần, giữ cache sau đó
  const query = useCommandMenu(wanted || q !== null);
  return useSuggestCore({
    text,
    caret,
    q,
    menu: { items: query.data?.items, isError: query.isError, refetch: query.refetch },
    filter: filterCmd,
    fill: fillCmd,
  });
}

export function useAgentSuggest(text: string, caret: number): AgentSuggest {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const q = mentionQuery(text, caret);
  const [wanted, setWanted] = useState(false);
  if (q !== null && !wanted) setWanted(true);
  const query = useAgentMenu(wanted || q !== null);
  const filter = useCallback(
    (items: Parameters<typeof filterAgents>[0], needle: string) =>
      filterAgents(items, needle, lang),
    [lang],
  );
  const core = useSuggestCore({
    text,
    caret,
    q,
    menu: { items: query.data?.items, isError: query.isError, refetch: query.refetch },
    filter,
    fill: (t, c, m: AgentMatch) => fillAgent(t, c, m.item.key),
  });
  // Tag đã gõ đủ và là dòng duy nhất: menu đóng để Enter gửi (Hub báo "nhập nội dung sau @tag"), không điền lại.
  const exact = core.matches.length === 1 && core.matches[0]?.item.key === q;
  return exact ? { ...core, open: false } : core;
}

/** Hai menu loại trừ nhau (`/…` hoặc `@…`): `current` là menu đang mở (ưu tiên `@`), `aria` cho textarea. */
export function useComposerSuggest(text: string, caret: number) {
  const command = useCommandSuggest(text, caret);
  const agent = useAgentSuggest(text, caret);
  const agentMode = agent.open;
  const current: Pick<Suggest<unknown>, "open" | "matches" | "active" | "move" | "dismiss"> &
    Pick<CommandSuggest, "pick"> = agentMode ? agent : command;
  const menuId = agentMode ? AGENT_MENU_ID : COMMAND_MENU_ID;
  const aria = {
    controls: current.open ? menuId : undefined,
    activeDescendant:
      current.open && current.matches.length > 0 ? optionId(menuId, current.active) : undefined,
  };
  return { command, agent, current, aria };
}

// CR-147c · danh sách «Nhắc tên» tải dần: tìm phía máy chủ (debounce), 20 người/lần theo `cursor` (= số đã nhận), trang đầy ⇒ còn nữa.
import type { MentionablePerson } from "@ai/contracts/community";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./ctx";
import type { PeopleScope } from "./ports";

export const PEOPLE_PAGE = 20;
const DEBOUNCE_MS = 250;

export function usePeople(enabled: boolean, query: string, scope: PeopleScope) {
  const { api } = useApp();
  const [people, setPeople] = useState<MentionablePerson[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const seq = useRef(0);
  const scopeKey = JSON.stringify(scope);
  const q = query.replace(/^@/, "").trim();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `scopeKey` = phạm vi đã tuần tự hoá
  useEffect(() => {
    if (!enabled) return;
    const n = ++seq.current;
    setState("loading");
    const h = setTimeout(
      () =>
        api.mentionablePeople(q, scope).then(
          (r) => {
            if (n !== seq.current) return;
            setPeople(r);
            setMore(r.length >= PEOPLE_PAGE);
            setState("ok");
          },
          () => n === seq.current && setState("error"),
        ),
      q ? DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(h);
  }, [api, enabled, q, scopeKey]);

  const loadMore = useCallback(async () => {
    if (!more || state !== "ok") return;
    const n = seq.current;
    const r = await api.mentionablePeople(q, scope, String(people.length)).catch(() => null);
    if (!r || n !== seq.current) return;
    setPeople((cur) => [...cur, ...r.filter((p) => !cur.some((c) => c.userId === p.userId))]);
    setMore(r.length >= PEOPLE_PAGE);
  }, [api, more, state, q, scope, people.length]);

  return { people, more, state, loadMore };
}

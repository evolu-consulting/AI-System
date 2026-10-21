// M2-chat · trạng thái hội thoại trợ lý: giữ NGOÀI khoang (đóng khoang / đổi sang sheet không mất, câu trả lời đang chạy vẫn tới)
// tới khi tải lại trang — như mgmt-app `useKept`. Một hội thoại Hub + một flow cho cả phiên; gửi khi đang trả lời ⇒ chặn.
import { ApiError } from "@ai/web-kit/http";
import { useSyncExternalStore } from "react";
import { cancelRun, createConversation, sendAndStream } from "../api";
import { applyEvent, buildRequest, dockContext, type Msg, titleOf } from "../lib/chat.rules";

type State = { msgs: Msg[]; convId: string | null; flowId: string | null; runId: string | null };
let state: State = { msgs: [], convId: null, flowId: null, runId: null };
const subs = new Set<() => void>();
const set = (f: (s: State) => State) => {
  state = f(state);
  for (const s of subs) s();
};
const patchLast = (f: (m: Msg) => Msg) =>
  set((s) => ({ ...s, msgs: [...s.msgs.slice(0, -1), f(s.msgs[s.msgs.length - 1] as Msg)] }));

/** Chỉ test: về rỗng. */
export function resetAssistantChat(): void {
  set(() => ({ msgs: [], convId: null, flowId: null, runId: null }));
}

async function ensureConversation(question: string): Promise<string> {
  if (state.convId) return state.convId;
  const c = await createConversation(titleOf(question));
  set((s) => ({ ...s, convId: c.id }));
  return c.id;
}

export async function ask(
  question: string,
  errorText: (code?: string) => string,
  instruction?: string,
): Promise<void> {
  const q = question.trim();
  if (!q || state.msgs.some((m) => m.pending)) return;
  set((s) => ({
    ...s,
    msgs: [...s.msgs, { role: "user", text: q }, { role: "assistant", text: "", pending: true }],
  }));
  try {
    const convId = await ensureConversation(q);
    const loc = typeof location === "undefined" ? null : location;
    const dock = loc ? dockContext(loc.pathname, loc.search) : undefined;
    const req = buildRequest(q, state.flowId, loc?.href ?? null, dock, instruction);
    const sent = await sendAndStream(convId, req, (e) => {
      if (e.event === "run.started")
        set((s) => ({ ...s, flowId: e.data.flow_id, runId: e.data.run_id }));
      patchLast((m) => applyEvent(m, e));
    });
    set((s) => ({ ...s, flowId: sent.flowId ?? s.flowId, runId: null }));
    patchLast((m) => (m.pending ? { ...m, pending: false } : m));
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    set((s) => ({ ...s, runId: null }));
    patchLast((m) => ({ ...m, pending: false, step: undefined, error: errorText(code) }));
  }
}

export async function stop(): Promise<void> {
  if (state.runId) await cancelRun(state.runId).catch(() => {});
}

export function useAssistantChat(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

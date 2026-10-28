// com-c10b · trạng thái hội thoại Trợ lý giá: giữ NGOÀI khung (đóng khung không mất, câu trả lời đang chạy vẫn tới). Một hội
// thoại Hub + một flow cho cả phiên; gửi khi đang trả lời ⇒ chặn.
import type { MessageContext } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { useSyncExternalStore } from "react";
import type { CommunityApi } from "../api/client";
import { applyEvent, buildRequest, errorText, type Msg, titleOf } from "../lib/dock";

type State = { msgs: Msg[]; convId: string | null; flowId: string | null; runId: string | null };
let state: State = { msgs: [], convId: null, flowId: null, runId: null };
const subs = new Set<() => void>();
const set = (f: (s: State) => State) => {
  state = f(state);
  for (const s of subs) s();
};
const patchLast = (f: (m: Msg) => Msg) =>
  set((s) => ({ ...s, msgs: [...s.msgs.slice(0, -1), f(s.msgs[s.msgs.length - 1] as Msg)] }));

export function resetDock(): void {
  set(() => ({ msgs: [], convId: null, flowId: null, runId: null }));
}

export async function ask(api: CommunityApi, question: string, ctx: MessageContext): Promise<void> {
  const q = question.trim();
  if (!q || state.msgs.some((m) => m.pending)) return;
  set((s) => ({
    ...s,
    msgs: [...s.msgs, { role: "user", text: q }, { role: "assistant", text: "", pending: true }],
  }));
  try {
    let convId = state.convId;
    if (!convId) {
      convId = (await api.chat.createConversation(titleOf(q))).id;
      set((s) => ({ ...s, convId }));
    }
    const sent = await api.chat.send(convId, buildRequest(q, state.flowId, ctx), (e) => {
      if (e.event === "run.started")
        set((s) => ({ ...s, flowId: e.data.flow_id, runId: e.data.run_id }));
      patchLast((m) => applyEvent(m, e));
    });
    set((s) => ({ ...s, flowId: sent.flowId ?? s.flowId, runId: null }));
    patchLast((m) => (m.pending ? { ...m, pending: false } : m));
  } catch (err) {
    set((s) => ({ ...s, runId: null }));
    const code = err instanceof ApiError ? err.code : undefined;
    patchLast((m) => ({ ...m, pending: false, step: undefined, error: errorText(code) }));
  }
}

export async function stop(api: CommunityApi): Promise<void> {
  if (state.runId) await api.chat.cancel(state.runId).catch(() => {});
}

export function useDock(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

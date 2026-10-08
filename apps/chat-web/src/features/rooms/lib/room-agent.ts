// HUB-FR-101, HUB-FR-103 · X2b plan-frontend §0 D6–D9, §3: logic thuần của agent trong phòng — vai theo từng lượt
// (`caller`), nhãn agent, run đang chạy/chờ (`active_runs`), khử trùng theo `run_id`, tin "của mình" cho pill/đã đọc.
import type {
  RoomActiveRun,
  RoomAgentRef,
  RoomDetail,
  RoomMessage,
  RoomRunStartedEventData,
} from "@ai/contracts/chat";
import type { RoomMessagesData } from "./room-cache";

/** Tên agent theo ngôn ngữ; `null`/vắng = Orchestrator (nhãn do caller truyền vào). */
export function agentName(
  agent: RoomAgentRef | null | undefined,
  lang: string,
  orchestrator: string,
): string {
  if (!agent) return orchestrator;
  return lang.startsWith("en") ? agent.name.en : agent.name.vi;
}

/** Tin gọi do mình gửi, hoặc tin agent của lượt mình gửi (R19: không tính chưa đọc/pill cho mình). */
export function isOwnTurn(m: Pick<RoomMessage, "sender_type" | "sender" | "caller">, myId: string) {
  if (m.sender_type === "agent") return m.caller?.id === myId;
  return m.sender.id === myId;
}

export function lastIsOwnTurn(messages: readonly RoomMessage[], myId: string): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && isOwnTurn(last, myId);
}

/** Số tin mới (sau `seenSeq`) không phải lượt của mình → pill "tin mới". */
export function newFromOthers(messages: readonly RoomMessage[], seenSeq: number, myId: string) {
  return messages.filter((m) => m.seq > seenSeq && !isOwnTurn(m, myId)).length;
}

/** `placement` vắng ≡ `main`. */
export const isMainPlacement = (m: Pick<RoomMessage, "placement">) =>
  (m.placement ?? "main") === "main";

/** Run thành `RoomActiveRun` (từ sự kiện `room.run_started` hoặc header POST của người gửi). */
export function activeRunOf(
  e: Omit<RoomRunStartedEventData, "room_id">,
  startedAt: string,
): RoomActiveRun {
  return {
    run_id: e.run_id,
    flow_id: e.flow_id,
    trigger_message_id: e.trigger_message_id,
    agent: e.agent,
    caller: e.caller,
    status: "running",
    started_at: startedAt,
  };
}

/** Run mới của cùng người trong cùng flow ⇒ lượt chờ cũ của người đó đã được trả lời (BE `room_run_states`). */
const supersedes = (run: RoomActiveRun) => (r: RoomActiveRun) =>
  r.status === "waiting" &&
  r.run_id !== run.run_id &&
  r.flow_id === run.flow_id &&
  r.caller.id === run.caller.id;

/** Thêm run (khử trùng `run_id`: đã có thì giữ bản cũ, chỉ bù `agent` khi bản cũ thiếu); bỏ lượt chờ nó thay. */
export function addActiveRun(
  d: RoomDetail | undefined,
  run: RoomActiveRun,
): RoomDetail | undefined {
  if (!d) return d;
  const all = d.active_runs ?? [];
  const stale = supersedes(run);
  const runs = all.some(stale) ? all.filter((r) => !stale(r)) : all;
  const cur = runs.find((r) => r.run_id === run.run_id);
  if (!cur) return { ...d, active_runs: [...runs, run] };
  if (cur.agent || !run.agent) return runs === all ? d : { ...d, active_runs: runs };
  return { ...d, active_runs: runs.map((r) => (r === cur ? { ...cur, agent: run.agent } : r)) };
}

export function patchActiveRun(
  d: RoomDetail | undefined,
  runId: string,
  patch: Partial<Pick<RoomActiveRun, "status" | "wait_kind">>,
): RoomDetail | undefined {
  if (!d?.active_runs?.some((r) => r.run_id === runId)) return d;
  return {
    ...d,
    active_runs: d.active_runs.map((r) => (r.run_id === runId ? { ...r, ...patch } : r)),
  };
}

export function removeActiveRun(d: RoomDetail | undefined, runId: string): RoomDetail | undefined {
  if (!d?.active_runs?.some((r) => r.run_id === runId)) return d;
  return { ...d, active_runs: d.active_runs.filter((r) => r.run_id !== runId) };
}

/** `room.run_finished`: run đang chờ (`need_input`/`side_effect`) vẫn là lượt chờ tới khi được trả lời; còn lại bỏ. */
export function finishActiveRun(
  d: RoomDetail | undefined,
  runId: string,
  status: string,
): RoomDetail | undefined {
  const cur = d?.active_runs?.find((r) => r.run_id === runId);
  if (cur?.status === "waiting" && status === "finished") return d;
  return removeActiveRun(d, runId);
}

/** Tin agent tới: có `ask` ⇒ lượt chờ (thêm nếu chưa có); không ⇒ run xong, bỏ khỏi `active_runs`. */
export function applyAgentMessage(
  d: RoomDetail | undefined,
  m: RoomMessage,
): RoomDetail | undefined {
  if (!d || !m.run_id) return d;
  if (!m.ask || m.run_status !== "finished" || !m.flow_id || !m.caller) {
    return removeActiveRun(d, m.run_id);
  }
  const patch = { status: "waiting" as const, wait_kind: m.ask.kind };
  if (d.active_runs?.some((r) => r.run_id === m.run_id)) return patchActiveRun(d, m.run_id, patch);
  const run: RoomActiveRun = {
    run_id: m.run_id,
    flow_id: m.flow_id,
    trigger_message_id: m.trigger_message_id ?? m.id,
    agent: m.agent ?? null,
    caller: m.caller,
    started_at: m.created_at,
    ...patch,
  };
  return { ...d, active_runs: [...(d.active_runs ?? []), run] };
}

/** `run_id` đang chờ trả lời/xác nhận → AskCard/WaitingNote ở khối agent tương ứng. */
export function waitingRunIds(runs: readonly RoomActiveRun[] | undefined): ReadonlySet<string> {
  return new Set((runs ?? []).filter((r) => r.status === "waiting").map((r) => r.run_id));
}

/** Khối "đang xử lý" (D7): run đang chạy chưa có tin agent cùng `run_id` trong timeline, theo `started_at` tăng. */
export function pendingRuns(
  runs: readonly RoomActiveRun[] | undefined,
  messages: readonly RoomMessage[],
): RoomActiveRun[] {
  if (!runs || runs.length === 0) return [];
  const done = new Set(messages.filter((m) => m.sender_type === "agent").map((m) => m.run_id));
  return runs
    .filter((r) => r.status !== "waiting" && !done.has(r.run_id))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** Tin `placement=flow` mới: tăng `flow.message_count`/`last_active_at` của khối agent gốc cùng `flow_id` ở timeline. */
export function bumpFlowOf(
  data: RoomMessagesData | undefined,
  m: Pick<RoomMessage, "flow_id" | "created_at">,
): RoomMessagesData | undefined {
  if (!data || !m.flow_id) return data;
  let hit = false;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.map((x) => {
      if (hit || x.flow_id !== m.flow_id || !x.flow) return x;
      hit = true;
      return {
        ...x,
        flow: {
          message_count: x.flow.message_count + 1,
          last_active_at:
            m.created_at > x.flow.last_active_at ? m.created_at : x.flow.last_active_at,
        },
      };
    }),
  }));
  return hit ? { ...data, pages } : data;
}

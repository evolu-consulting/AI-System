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

/** Thêm run (khử trùng `run_id`: đã có thì giữ bản cũ, chỉ bù `agent` khi bản cũ thiếu). */
export function addActiveRun(
  d: RoomDetail | undefined,
  run: RoomActiveRun,
): RoomDetail | undefined {
  if (!d) return d;
  const runs = d.active_runs ?? [];
  const cur = runs.find((r) => r.run_id === run.run_id);
  if (!cur) return { ...d, active_runs: [...runs, run] };
  if (cur.agent || !run.agent) return d;
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

/** Khối "đang xử lý" (D7): run chưa có tin agent cùng `run_id` trong timeline, theo `started_at` tăng. */
export function pendingRuns(
  runs: readonly RoomActiveRun[] | undefined,
  messages: readonly RoomMessage[],
): RoomActiveRun[] {
  if (!runs || runs.length === 0) return [];
  const done = new Set(messages.filter((m) => m.sender_type === "agent").map((m) => m.run_id));
  return runs
    .filter((r) => !done.has(r.run_id))
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

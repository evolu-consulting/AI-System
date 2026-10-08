// HUB-FR-101, HUB-FR-103 · logic thuần agent trong phòng: nhãn, vai theo lượt, active_runs, khử trùng, đếm flow.
import { expect, test } from "bun:test";
import type { RoomActiveRun, RoomDetail, RoomMessage } from "@ai/contracts/chat";
import {
  activeRunOf,
  addActiveRun,
  agentName,
  bumpFlowOf,
  isMainPlacement,
  isOwnTurn,
  patchActiveRun,
  pendingRuns,
  removeActiveRun,
} from "./room-agent";
import type { RoomMessagesData } from "./room-cache";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = uid(1);
const LAN = uid(2);
const AGENT = { key: "hoadon", name: { vi: "Hoá đơn", en: "Invoices" } };
const AT = "2026-10-08T01:00:00.000Z";

const run = (n: number, startedAt = AT, caller = LAN): RoomActiveRun =>
  activeRunOf(
    {
      run_id: uid(100 + n),
      flow_id: uid(200 + n),
      trigger_message_id: uid(300 + n),
      agent: AGENT,
      caller: { id: caller, display_name: "Lan" },
    },
    startedAt,
  );
const detail = (runs?: RoomActiveRun[]) => ({ id: uid(9), active_runs: runs }) as RoomDetail;
const msg = (over: Partial<RoomMessage>): RoomMessage => ({
  id: uid(500),
  room_id: uid(9),
  seq: 1,
  sender_type: "user",
  sender: { id: LAN, display_name: "Lan" },
  content: "x",
  client_msg_id: null,
  created_at: AT,
  ...over,
});

test("agentName theo ngôn ngữ; null → Orchestrator", () => {
  expect(agentName(AGENT, "vi", "Orch")).toBe("Hoá đơn");
  expect(agentName(AGENT, "en-US", "Orch")).toBe("Invoices");
  expect(agentName(null, "vi", "Orch")).toBe("Orch");
});

test("isOwnTurn: tin người theo sender, tin agent theo caller (R19)", () => {
  expect(isOwnTurn(msg({ sender: { id: ME, display_name: "Me" } }), ME)).toBe(true);
  expect(isOwnTurn(msg({}), ME)).toBe(false);
  const agentMsg = msg({ sender_type: "agent", caller: { id: ME, display_name: "Me" } });
  expect(isOwnTurn(agentMsg, ME)).toBe(true);
  expect(isOwnTurn({ ...agentMsg, caller: { id: LAN, display_name: "Lan" } }, ME)).toBe(false);
  expect(isOwnTurn({ ...agentMsg, caller: undefined }, ME)).toBe(false);
});

test("isMainPlacement: vắng ≡ main", () => {
  expect(isMainPlacement({})).toBe(true);
  expect(isMainPlacement({ placement: "flow" })).toBe(false);
});

test("add/patch/remove active run, khử trùng run_id, bù agent", () => {
  const a = run(1);
  let d = addActiveRun(detail(), a);
  expect(d?.active_runs).toHaveLength(1);
  expect(addActiveRun(d, a)).toBe(d);
  const noAgent = addActiveRun(detail(), { ...a, agent: null });
  expect(addActiveRun(noAgent, a)?.active_runs?.[0]?.agent).toEqual(AGENT);
  d = patchActiveRun(d, a.run_id, { status: "waiting", wait_kind: "need_input" });
  expect(d?.active_runs?.[0]).toMatchObject({ status: "waiting", wait_kind: "need_input" });
  expect(patchActiveRun(d, uid(999), { status: "running" })).toBe(d);
  expect(removeActiveRun(d, a.run_id)?.active_runs).toEqual([]);
  expect(addActiveRun(undefined, a)).toBeUndefined();
});

test("pendingRuns: bỏ run đã có tin agent cùng run_id, xếp theo started_at", () => {
  const a = run(1, "2026-10-08T02:00:00.000Z");
  const b = run(2, "2026-10-08T01:00:00.000Z");
  const c = run(3);
  const done = msg({ sender_type: "agent", run_id: c.run_id });
  const trigger = msg({ run_id: a.run_id });
  expect(pendingRuns([a, b, c], [done, trigger]).map((r) => r.run_id)).toEqual([
    b.run_id,
    a.run_id,
  ]);
  expect(pendingRuns(undefined, [])).toEqual([]);
});

test("bumpFlowOf: tăng đếm + last_active_at của khối gốc cùng flow_id", () => {
  const root = msg({
    sender_type: "agent",
    flow_id: uid(200),
    flow: { message_count: 2, last_active_at: AT },
  });
  const data: RoomMessagesData = {
    pages: [{ items: [root], has_more: false }],
    pageParams: [undefined],
  };
  const later = "2026-10-08T03:00:00.000Z";
  const next = bumpFlowOf(data, { flow_id: uid(200), created_at: later });
  expect(next?.pages[0]?.items[0]?.flow).toEqual({ message_count: 3, last_active_at: later });
  expect(bumpFlowOf(data, { flow_id: uid(201), created_at: later })).toBe(data);
});

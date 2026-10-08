// HUB-FR-101 · HUB-BR-21 · X2b gọi agent từ tin phòng (plan §3 hàng POST, §5 hàng Gọi, D5, D8, D12, D13, D15). Thứ tự kiểm:
// trùng `client_msg_id` → 200 · thread / `answer_run_id` (404 `NOT_FOUND`, 403 `NOT_RUN_CALLER`) → tag ∉ AU người tag (404
// `AGENT_NOT_FOUND`, không ghi) → MỘT tx `user` của người gọi: khoá `rooms` → kiểm lại → hội thoại nền → flow nền →
// `createRunTx` (409/429 ⇒ ROLLBACK, tin không vào phòng) → `runs.room_id` → `seq` → tin gọi → ngữ cảnh (§6). Sau COMMIT:
// `room.message`, `room.unread`, `room.run_started` rồi `launch`. Quyền/quota luôn theo NGƯỜI GỬI tin (BR-21).
import {
  deriveTitle,
  type RoomAgentRef,
  type RoomMessage,
  type SendMessageRequest,
  type SendRoomMessageRequest,
} from "@ai/contracts/chat";
import type { HistoryItem } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import type { UserEvent } from "../../../lib/user-stream";
import { accessInput, visibleAgents } from "../../agents/agent-access.rules";
import type { ConfigCache } from "../../config/config.service";
import type { MentionPlan, MentionRouted } from "../../mention/mention.service";
import type { PreparedRun, RunDriver, RunService } from "../../runs/runs.service";
import type { Me } from "../manage/rooms.repo";
import { lockFor, pgCode, type RoomsService } from "../manage/rooms.service";
import * as msgs from "../messages/messages.repo";
import { messageEvents } from "../room-events";
import { toRoomMessage } from "../rooms.map";
import {
  answerAccess,
  confirmStillAllowed,
  placementOf,
  type RoomRoute,
  roomContext,
} from "./room-agent.rules";
import * as ctx from "./room-context.repo";
import * as rt from "./room-run.tx";
import { runStartedEvents } from "./room-run-events";

export type AgentRoute = Exclude<RoomRoute, { kind: "plain" }>;
export type RoomSent = {
  message: RoomMessage;
  created: boolean;
  /** Có ⇔ đã tạo run: header `X-Run-Id`, `X-Flow-Id` (= thread). */
  run?: { runId: string; flowId: string };
};

export type RoomRunDeps = {
  rooms: RoomsService;
  runs: Pick<RunService, "prepare" | "createRunTx" | "launch">;
  prepareMention: (u: AuthUser, routed: MentionRouted) => Promise<MentionPlan>;
  /** `poll` (1 truy vấn phiên bản) trước khi kiểm quyền: thu hồi quyền có hiệu lực ngay cả khi NOTIFY chưa tới (AC14). */
  config: Pick<ConfigCache, "snapshot" | "user" | "poll">;
  /** D15 · huỷ ngay run xác nhận (E15 C1 ⇒ `onClosed` ⇒ tin agent "đã huỷ"). */
  cancel: { cancel(u: AuthUser, runId: string): Promise<unknown> };
};

type Thread = { flowId: string; rootSeq: number };
/** `answer`: flow nền của run chờ (`runs.flow_id`) + agent các xác nhận `pending` của nó. */
type Target = { thread: Thread | null; answerFlow?: string; pendingAgents: string[] };
type Call = { roomId: string; body: SendRoomMessageRequest; route: AgentRoute };
type Committed = RoomSent & { history?: HistoryItem[] };
type Tracked = { out: Committed; events: UserEvent[] };

/** D15 · driver không chạy gì: run được huỷ ngay sau `launch` qua E15. */
const IDLE_DRIVER: RunDriver = { start: () => {} };

/** §3 bước 4 · thread của phòng + run chờ (`answerAccess`). Gọi cả trước tx lẫn dưới khoá `rooms`. */
async function resolveTarget(tx: Tx, me: Me, c: Call): Promise<Target> {
  const { roomId, body, route } = c;
  let thread: Thread | null = null;
  if (body.flow_id) {
    const root = await ctx.threadRoot(tx, me, roomId, body.flow_id);
    if (!root) throw appError("NOT_FOUND");
    thread = { flowId: body.flow_id, rootSeq: root.seq };
  }
  if (route.kind !== "answer") return { thread, pendingAgents: [] };
  const st = await ctx.roomRunState(tx, roomId, route.runId);
  const run = st && {
    inThread: st.flowId === thread?.flowId,
    waiting: st.status === "waiting",
    callerId: st.callerId,
  };
  const access = answerAccess({ run, userId: me.userId });
  if (access === "not_caller") throw appError("NOT_RUN_CALLER");
  const answerFlow = access === "ok" ? await ctx.runFlowOf(tx, me, route.runId) : null;
  if (!answerFlow) throw appError("NOT_FOUND");
  return { thread, answerFlow, pendingAgents: await ctx.pendingConfirmAgents(tx, me, answerFlow) };
}

/** §6 · ngữ cảnh chụp trong tx gọi (2 truy vấn lọc `room_id`, không đọc `hub.messages`). */
async function loadHistory(
  tx: Tx,
  me: Me,
  q: { roomId: string; triggerSeq: number; thread: Thread | null },
): Promise<HistoryItem[]> {
  const { roomId, triggerSeq, thread } = q;
  const main = await ctx.contextRows(tx, me, { roomId, before: thread?.rootSeq ?? triggerSeq });
  if (!thread) return roomContext({ roomId, triggerSeq, main });
  const flowId = thread.flowId;
  const rows = await ctx.contextRows(tx, me, { roomId, before: triggerSeq, flowId });
  return roomContext({ roomId, triggerSeq, main, thread: { ...thread, rows } });
}

type Write = { call: Call; target: Target; p: PreparedRun };

/** D1/D12 · hội thoại nền → flow nền (mở thread / theo thread / run chờ) → `createRunTx` → `runs.room_id`. Trả flow nền. */
async function writeRun(tx: Tx, me: Me, w: Write & { runs: RoomRunDeps["runs"] }): Promise<string> {
  const { call, target, p } = w;
  const conversationId = await rt.ensureShim(tx, me, call.roomId);
  const thread = target.thread?.flowId ?? null;
  const title = deriveTitle(call.body.content);
  const flowId =
    target.answerFlow ?? (await rt.ensureFlow(tx, me, { conversationId, thread, title }));
  Object.assign(p.run, { conversationId, flowId });
  p.input.req = { ...p.input.req, flow_id: flowId };
  await w.runs.createRunTx(tx, p);
  await rt.setRunRoom(tx, me, p.run.id, call.roomId);
  return flowId;
}

const agentRef = (p: PreparedRun): RoomAgentRef | null =>
  p.direct ? { key: p.direct.agent.key, name: p.direct.agent.name } : null;

/** Tin gọi (`id = runs.user_message_id`, `flow_id` = thread, D12) + ngữ cảnh + sự kiện (người nhận đọc dưới khoá). */
async function writeTrigger(tx: Tx, me: Me, w: Write & { threadId: string }): Promise<Tracked> {
  const { call, target, p, threadId } = w;
  const { roomId, body } = call;
  const { seq, at } = await msgs.bumpSeq(tx, me, roomId);
  await msgs.advanceRead(tx, me, roomId, seq);
  const opensThread = !target.thread;
  const placement = placementOf({ senderType: "user", flowId: threadId, opensThread });
  const { content, client_msg_id: clientMsgId } = body;
  const id = p.run.userMessageId;
  const row = await msgs.insertMessage(tx, me, {
    ...{ id, roomId, seq, content, clientMsgId, at, flowId: threadId, placement },
  });
  const message = toRoomMessage(row);
  const history = await loadHistory(tx, me, { roomId, triggerSeq: seq, thread: target.thread });
  const fan = await msgs.fanout(tx, roomId);
  const agent = agentRef(p);
  const started = { roomId, runId: p.run.id, flowId: threadId, trigger: message, agent };
  const memberIds = fan.map((f) => f.user_id);
  const events = [...messageEvents(roomId, message, fan), ...runStartedEvents(started, memberIds)];
  const run = { runId: p.run.id, flowId: threadId };
  return { out: { message, created: true, run, history }, events };
}

export class RoomRunService {
  constructor(private readonly d: RoomRunDeps) {}

  /** 23505 (trùng `client_msg_id` / flow nền song song) ⇒ chạy lại một lần, rơi vào nhánh trùng / dùng hàng có sẵn. */
  async send(
    u: AuthUser,
    roomId: string,
    body: SendRoomMessageRequest,
    route: AgentRoute,
  ): Promise<RoomSent> {
    const call = { roomId, body, route };
    try {
      return await this.#sendOnce(u, call);
    } catch (err) {
      if (pgCode(err) !== "23505") throw err;
      return this.#sendOnce(u, call);
    }
  }

  async #sendOnce(u: AuthUser, call: Call): Promise<RoomSent> {
    const { roomId, body, route } = call;
    const pre = await this.d.rooms.read(u, async (tx, me) => {
      const dup = await msgs.findByClientId(tx, me, roomId, body.client_msg_id);
      return dup ? { dup: toRoomMessage(dup) } : { target: await resolveTarget(tx, me, call) };
    });
    if (pre.dup) return { message: pre.dup, created: false };
    await this.d.config.poll();
    const plan = await this.#plan(u, route);
    const req: SendMessageRequest = {
      content: route.kind === "agents" ? body.content : route.content,
    };
    const p = await this.d.runs.prepare(u, roomId, req, plan);
    const decline = await this.#mustDecline(u, pre.target.pendingAgents);
    if (decline) p.input.declineConfirm = true;
    const out = await this.d.rooms.commit(u, (tx, me) => this.#commit(tx, me, call, p));
    if (!out.created || !out.run) return out;
    // D16 · run phòng không mang file (`files = []`).
    await this.d.runs.launch(p, [], {
      roomHistory: out.history,
      ...(decline && { driver: IDLE_DRIVER }),
    });
    if (decline) await this.d.cancel.cancel(u, p.run.id);
    return { message: out.message, created: true, run: out.run };
  }

  /** D8 · tag → `MentionService.prepare` (AU người tag); `@orchestrator` + tag ⇒ Orchestrator thu hẹp; trả lời ⇒ C1. */
  async #plan(u: AuthUser, route: AgentRoute): Promise<MentionPlan | undefined> {
    if (route.kind === "agents") return this.d.prepareMention(u, route.routed);
    if (route.kind === "answer") return undefined;
    if (route.content === "")
      throw appError("CMD_MISSING_ARG", { missing: ["content"], invalid: [] });
    if (!route.onlyKeys) return undefined;
    const tags = [...route.onlyKeys];
    const plan = await this.d.prepareMention(u, { kind: "mention", tags, content: route.content });
    if (plan.kind === "orchestrated") return plan;
    return { kind: "orchestrated", content: plan.content, onlyKeys: new Set([plan.agent.key]) };
  }

  /** D15 [Q2] · agent đang chờ xác nhận ∉ AU (ảnh hiện hành) của người xác nhận ⇒ run mới huỷ ngay, xác nhận `declined`. */
  async #mustDecline(u: AuthUser, pendingAgents: readonly string[]): Promise<boolean> {
    if (pendingAgents.length === 0) return false;
    const [snapshot, user] = await Promise.all([
      this.d.config.snapshot(),
      this.d.config.user(u.userId),
    ]);
    const who = {
      tenantId: u.tenantId,
      userId: u.userId,
      groupIds: user?.groupIds ?? new Set<string>(),
    };
    const au = new Set(visibleAgents(accessInput(snapshot, who)).map((a) => a.id));
    return pendingAgents.some((id) => !confirmStillAllowed(id, au));
  }

  /** D5 · tx gọi (scope user người gửi); thứ tự khoá ở đầu file. Trùng dưới khoá ⇒ 200, không run. */
  async #commit(tx: Tx, me: Me, call: Call, p: PreparedRun): Promise<Tracked> {
    await lockFor(tx, me, call.roomId, "send");
    const dup = await msgs.findByClientId(tx, me, call.roomId, call.body.client_msg_id);
    if (dup) return { out: { message: toRoomMessage(dup), created: false }, events: [] };
    const target = await resolveTarget(tx, me, call);
    const flowId = await writeRun(tx, me, { call, target, p, runs: this.d.runs });
    const threadId = target.thread?.flowId ?? flowId;
    return writeTrigger(tx, me, { call, target, p, threadId });
  }
}

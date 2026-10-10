// HUB-FR-96 · HUB-FR-100 · tin phòng: lịch sử, gửi, đã đọc (X2a plan §3, D5, D13; plan-db §5 hàng Gửi/Đọc/Lịch sử, §6;
// spec R14–R19). Gửi: `lockFor` khoá hàng `rooms` TRƯỚC rồi kiểm thành viên dưới khoá (bị bớt song song ⇒ 404, P07) ⇒ `seq`
// liền, không trùng (X2a-AC07); `seq` cấp bằng definer `hub.room_next_seq` (RV1). Đánh dấu đọc cũng khoá phòng trước. Phát sau commit.
import type {
  MarkRoomFlowReadResponse,
  MarkRoomReadResponse,
  RoomMessage,
  RoomMessageListQuery,
  RoomMessagePage,
  SendRoomMessageRequest,
} from "@ai/contracts/chat";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { type Bang, classifyBang } from "../../processes/core/bang.rules";
import { processError } from "../../processes/core/errors";
import { type RoomRoute, routeRoomMessage } from "../agents/room-agent.rules";
import { threadRoot } from "../agents/room-context.repo";
import * as rooms from "../manage/rooms.repo";
import { guard, lockFor, pgCode, type RoomsService } from "../manage/rooms.service";
import { messageEvents, readEvents } from "../room-events";
import { toRoomMessage } from "../rooms.map";
import { clampReadSeq, type RoomAction, unreadOf } from "../rooms.rules";
import * as repo from "./messages.repo";

/** Seam dùng chung (CR-059 depcruise): PF1 `start.service` ghi tin gọi `!key` qua service, không import repo phòng. */
export { advanceRead, bumpSeq, fanout, findByClientId } from "./messages.repo";

/** `run` có ⇔ tin đã gọi agent (header `X-Run-Id`/`X-Flow-Id`, X2b D11); `process` ⇔ tin gọi `!key` (P-a T1). */
export type SendResult = {
  message: RoomMessage;
  created: boolean;
  run?: { runId: string; flowId: string };
  process?: { runId: string; flowId: string };
};
/** P-a T1 · `!key`/`!` sai ở timeline ⇒ PF1 (`processes/runs/room-start.ts`); lỗi ⇒ ROLLBACK, không lưu tin. */
export type RoomProcessSender = {
  start(
    u: AuthUser,
    roomId: string,
    body: SendRoomMessageRequest,
    bang: Extract<Bang, { kind: "process" | "invalid" }>,
  ): Promise<SendResult>;
};
/** X2b · `RoomRunService.send` (tách để module tin không phụ thuộc runtime). */
export type RoomAgentSender = {
  send(
    u: AuthUser,
    roomId: string,
    body: SendRoomMessageRequest,
    route: Exclude<RoomRoute, { kind: "plain" }>,
  ): Promise<SendResult>;
};
const PLAIN: RoomRoute = { kind: "plain" };

export class MessagesService {
  #agents?: RoomAgentSender;
  #processes?: RoomProcessSender;

  constructor(private readonly rooms: RoomsService) {}

  /** Route gọi trước khi parse body/query (404 trước 400, plan §3). */
  access(u: AuthUser, roomId: string, action: RoomAction): Promise<void> {
    return this.rooms.access(u, roomId, action);
  }

  /**
   * R14/R15 · `limit` tin trước `before_seq` (vắng ⇒ tin cuối), trả `seq` tăng dần. X2b: `flow_id` vắng ⇒ timeline
   * (`main`); có ⇒ thread — không phải thread của phòng ⇒ 404 `NOT_FOUND` (plan §3, sau `access view` + zod).
   */
  page(u: AuthUser, roomId: string, q: RoomMessageListQuery): Promise<RoomMessagePage> {
    return this.rooms.read(u, async (tx, me) => {
      guard(await rooms.findAccess(tx, me, roomId), "view");
      const flowId = q.flow_id;
      // P-a Bước 0 · thread hợp lệ = thread phòng (`main`) HOẶC thread quy trình (is_room_thread iii); non-member đã 404 ở `access view`.
      if (
        flowId &&
        !(await threadRoot(tx, me, roomId, flowId)) &&
        !(await repo.isProcessThread(tx, me, roomId, flowId))
      )
        throw appError("NOT_FOUND");
      const rows = await repo.pageDesc(tx, me, roomId, {
        beforeSeq: q.before_seq,
        limit: q.limit,
        ...(flowId && { flowId }),
      });
      return {
        items: rows.slice(0, q.limit).reverse().map(toRoomMessage),
        has_more: rows.length > q.limit,
      };
    });
  }

  /**
   * 201 mới / 200 trùng `client_msg_id` (không sự kiện). Gửi trùng song song tuần tự hoá ở khoá `rooms` nên bên sau thấy
   * tin của bên trước; 23505 (`room_messages_client_uq`) là lưới cuối ⇒ chạy lại một lần, rơi vào nhánh trùng.
   */
  async send(u: AuthUser, roomId: string, req: SendRoomMessageRequest): Promise<SendResult> {
    const p = this.#processes;
    const pre = p ? await this.#processRoute(p, u, roomId, req) : { body: req };
    if ("result" in pre) return pre.result;
    const { body } = pre;
    const route = this.#agents
      ? routeRoomMessage(body.content, { answerRunId: body.answer_run_id })
      : PLAIN;
    if (route.kind !== "plain" && this.#agents) return this.#agents.send(u, roomId, body, route);
    try {
      return await this.sendOnce(u, roomId, body);
    } catch (err) {
      if (pgCode(err) !== "23505") throw err;
      return this.sendOnce(u, roomId, body);
    }
  }

  /** X2b · gắn đường gọi agent (cần RunService ⇒ nối sau khi `app.ts` dựng runtime); vắng = mọi tin là tin thường. */
  useAgents(agents: RoomAgentSender): void {
    this.#agents = agents;
  }

  /** P-a D15 · cờ `HUB_PROCESS_ENGINE` bật ⇒ nối `!` + luật thread quy trình (T7); vắng = `!` là chữ thường. */
  useProcesses(processes: RoomProcessSender): void {
    this.#processes = processes;
  }

  /**
   * P-a plan §7 + T7 (trước `routeRoomMessage`, bỏ qua khi có `answer_run_id`): `!!` ⇒ bỏ một `!`; timeline `!…` ⇒ PF1.
   * Có `flow_id`: `!…` là chữ; thread quy trình + tag `@` đầu tin ⇒ 422 `PROCESS_THREAD_NO_AGENT` (không lưu, 0 run).
   */
  async #processRoute(
    p: RoomProcessSender,
    u: AuthUser,
    roomId: string,
    body: SendRoomMessageRequest,
  ): Promise<{ body: SendRoomMessageRequest } | { result: SendResult }> {
    if (body.answer_run_id !== undefined) return { body };
    const bang = classifyBang(body.content);
    const flowId = body.flow_id;
    if (flowId !== undefined) {
      const inProcess = await this.rooms.read(u, (tx, me) =>
        repo.isProcessThread(tx, me, roomId, flowId),
      );
      if (inProcess && routeRoomMessage(body.content, {}).kind !== "plain")
        throw processError("PROCESS_THREAD_NO_AGENT");
    } else if (bang.kind === "process" || bang.kind === "invalid") {
      return { result: await p.start(u, roomId, body, bang) };
    }
    return { body: bang.kind === "escaped" ? { ...body, content: bang.content } : body };
  }

  /** Tin người↔người (X2a; X2b D13a: trong thread `flow_id` ⇒ kiểm thread của phòng, `placement=flow`, 0 run). */
  private sendOnce(u: AuthUser, roomId: string, body: SendRoomMessageRequest): Promise<SendResult> {
    return this.rooms.commit<SendResult>(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "send");
      const dup = await repo.findByClientId(tx, me, roomId, body.client_msg_id);
      if (dup) return { out: { message: toRoomMessage(dup), created: false }, events: [] };
      const flowId = body.flow_id;
      // P-a Bước 0 · thread phòng HOẶC thread quy trình (is_room_thread iii); thành viên vẫn do `lockFor` giữ (404 nếu bị bớt).
      if (
        flowId &&
        !(await threadRoot(tx, me, roomId, flowId)) &&
        !(await repo.isProcessThread(tx, me, roomId, flowId))
      )
        throw appError("NOT_FOUND");
      const { seq, at } = await repo.bumpSeq(tx, me, roomId);
      await repo.advanceRead(tx, me, roomId, seq);
      const row = await repo.insertMessage(tx, me, {
        roomId,
        seq,
        content: body.content,
        clientMsgId: body.client_msg_id,
        at,
        ...(flowId && { flowId, placement: "flow" as const }),
      });
      // CR-050: người gửi đã thấy thread tới tin của chính mình.
      if (flowId) await repo.advanceFlowRead(tx, me, { roomId, flowId, seq });
      const message = toRoomMessage(row);
      const fan = await repo.fanout(tx, roomId);
      return { out: { message, created: true }, events: messageEvents(roomId, message, fan) };
    });
  }

  /**
   * CR-050 · đã xem thread tới `seq` (khung thread đang mở ở đáy): mốc chỉ tăng, kẹp ≤ seq lớn nhất của thread; thread không
   * thuộc phòng ⇒ 404 `NOT_FOUND` (như `page`). Chỉ chạm hàng của mình ⇒ không phát sự kiện cho người khác.
   */
  markFlowRead(
    u: AuthUser,
    roomId: string,
    flowId: string,
    seq: number,
  ): Promise<MarkRoomFlowReadResponse> {
    return this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "read");
      // P-a Bước 0 · thread phòng HOẶC thread quy trình (is_room_thread iii); thành viên do `lockFor` giữ.
      if (
        !(await threadRoot(tx, me, roomId, flowId)) &&
        !(await repo.isProcessThread(tx, me, roomId, flowId))
      )
        throw appError("NOT_FOUND");
      const unread = await repo.advanceFlowRead(tx, me, { roomId, flowId, seq });
      return { out: { unread }, events: [] };
    });
  }

  /**
   * R18/R19 · mốc đọc chỉ tăng, kẹp ≤ `last_seq`; không đổi ⇒ trả số hiện tại, không sự kiện. Khoá phòng + kiểm lại
   * thành viên (RV1 #5): bị bớt song song ⇒ 404, người nhận `room.read` đọc dưới khoá (không gửi cho người vừa bị bớt).
   */
  markRead(u: AuthUser, roomId: string, seq: number): Promise<MarkRoomReadResponse> {
    return this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "read");
      const st = await repo.readState(tx, me, roomId);
      if (!st) throw appError("ROOM_NOT_FOUND");
      const next = clampReadSeq(seq, st.lastReadSeq, st.lastSeq);
      const read = next === null ? null : await repo.advanceRead(tx, me, roomId, next);
      if (next !== null && read === null) throw appError("ROOM_NOT_FOUND");
      const mark = read ?? st.lastReadSeq;
      const self = { unread: unreadOf(st.lastSeq, mark), total: await rooms.unreadTotal(tx, me) };
      const out = { unread: self.unread, unread_total: self.total };
      if (read === null) return { out, events: [] };
      const ids = await rooms.activeMemberIds(tx, me, roomId);
      return { out, events: readEvents(roomId, me.userId, read, ids, self) };
    });
  }
}

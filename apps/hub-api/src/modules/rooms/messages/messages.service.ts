// HUB-FR-96 · HUB-FR-100 · tin phòng: lịch sử, gửi, đã đọc (X2a plan §3, D5, D13; plan-db §5 hàng Gửi/Đọc/Lịch sử, §6;
// spec R14–R19). Gửi: `lockFor` khoá hàng `rooms` TRƯỚC rồi kiểm thành viên dưới khoá (bị bớt song song ⇒ 404, P07) ⇒ `seq`
// liền, không trùng (X2a-AC07); `seq` cấp bằng definer `hub.room_next_seq` (RV1). Đánh dấu đọc cũng khoá phòng trước. Phát sau commit.
import type {
  MarkRoomReadResponse,
  RoomMessage,
  RoomMessageListQuery,
  RoomMessagePage,
  SendRoomMessageRequest,
} from "@ai/contracts/chat";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import * as rooms from "../manage/rooms.repo";
import { guard, lockFor, pgCode, type RoomsService } from "../manage/rooms.service";
import { messageEvents, readEvents } from "../room-events";
import { toRoomMessage } from "../rooms.map";
import { clampReadSeq, type RoomAction, unreadOf } from "../rooms.rules";
import * as repo from "./messages.repo";

export type SendResult = { message: RoomMessage; created: boolean };

export class MessagesService {
  constructor(private readonly rooms: RoomsService) {}

  /** Route gọi trước khi parse body/query (404 trước 400, plan §3). */
  access(u: AuthUser, roomId: string, action: RoomAction): Promise<void> {
    return this.rooms.access(u, roomId, action);
  }

  /** R14/R15 · `limit` tin trước `before_seq` (vắng ⇒ tin cuối), trả `seq` tăng dần. */
  page(u: AuthUser, roomId: string, q: RoomMessageListQuery): Promise<RoomMessagePage> {
    return this.rooms.read(u, async (tx, me) => {
      guard(await rooms.findAccess(tx, me, roomId), "view");
      const rows = await repo.pageDesc(tx, me, roomId, { beforeSeq: q.before_seq, limit: q.limit });
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
  async send(u: AuthUser, roomId: string, body: SendRoomMessageRequest): Promise<SendResult> {
    try {
      return await this.sendOnce(u, roomId, body);
    } catch (err) {
      if (pgCode(err) !== "23505") throw err;
      return this.sendOnce(u, roomId, body);
    }
  }

  private sendOnce(u: AuthUser, roomId: string, body: SendRoomMessageRequest): Promise<SendResult> {
    return this.rooms.commit<SendResult>(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "send");
      const dup = await repo.findByClientId(tx, me, roomId, body.client_msg_id);
      if (dup) return { out: { message: toRoomMessage(dup), created: false }, events: [] };
      const { seq, at } = await repo.bumpSeq(tx, me, roomId);
      await repo.advanceRead(tx, me, roomId, seq);
      const row = await repo.insertMessage(tx, me, {
        roomId,
        seq,
        content: body.content,
        clientMsgId: body.client_msg_id,
        at,
      });
      const message = toRoomMessage(row);
      const fan = await repo.fanout(tx, roomId);
      return { out: { message, created: true }, events: messageEvents(roomId, message, fan) };
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

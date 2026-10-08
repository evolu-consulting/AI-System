// HUB-FR-97 · HUB-FR-98 · thành viên phòng: thêm/bớt/rời/chuyển chủ/ẩn DM (X2a plan §3; plan-db §5, §6; spec R07–R11, R20).
// Thêm/bớt/rời/chuyển chủ: `lockFor` khoá hàng `rooms` TRƯỚC rồi kiểm lại quyền + đọc thành viên dưới khoá ⇒ giới hạn 50
// đúng dưới tranh chấp, người nhận sự kiện nhất quán (R20). Ẩn DM cũng khoá phòng trước, chỉ ghi hàng mình. Phát sau commit.
import { UuidSchema } from "@ai/contracts";
import { ROOM_MEMBERS_MAX, type RoomDetail } from "@ai/contracts/chat";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import type { UserEvent } from "../../../lib/user-stream";
import {
  deletedEvents,
  memberAddedEvents,
  memberRemovedEvents,
  updatedEvents,
} from "../room-events";
import { leaveOutcome, planAddMembers, type RoomAction } from "../rooms.rules";
import * as repo from "./members.repo";
import * as rooms from "./rooms.repo";
import { loadDetail, lockFor, type RoomsService, summaryAs } from "./rooms.service";

const userNotFound = (ids: string[]) => appError("USER_NOT_FOUND", { user_ids: ids });
const badUserId = () =>
  validationError([{ path: ["user_id"], code: "custom", message: "Invalid user_id" }]);
const without = (ids: readonly string[], id: string) => ids.filter((x) => x !== id);

export class MembersService {
  constructor(private readonly rooms: RoomsService) {}

  /** Route gọi trước khi parse body/param (404 → 409 → 403 trước 400, plan §3). */
  access(u: AuthUser, roomId: string, action: RoomAction): Promise<void> {
    return this.rooms.access(u, roomId, action);
  }

  /** R08/R09 · đếm + ghi dưới khoá `rooms`; vượt 50 ⇒ `ROOM_FULL`, không ghi; đã là thành viên ⇒ 200 không đổi. */
  add(u: AuthUser, roomId: string, userIds: readonly string[]): Promise<RoomDetail> {
    return this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "add");
      const current = await rooms.activeMemberIds(tx, me, roomId);
      const plan = planAddMembers(current, userIds);
      if (plan.full)
        throw appError("ROOM_FULL", { max: ROOM_MEMBERS_MAX, requested: plan.requestedTotal });
      if (plan.toAdd.length === 0) return { out: await loadDetail(tx, me, roomId), events: [] };
      const ok = await rooms.usableUserIds(tx, me.tenantId, plan.toAdd);
      const missing = plan.toAdd.filter((id) => !ok.has(id));
      if (missing.length > 0) throw userNotFound(missing);
      await repo.addMembers(tx, me, roomId, plan.toAdd);
      const room = await loadDetail(tx, me, roomId);
      const added = plan.toAdd.map((id) => ({ userId: id, room: summaryAs(room, "member") }));
      return {
        out: room,
        events: memberAddedEvents(roomId, added, [...current, ...plan.toAdd]),
      };
    });
  }

  /** R09 · `:user_id` không uuid / chính mình ⇒ 400; không phải thành viên hiện tại ⇒ 404 `USER_NOT_FOUND`. */
  removeMember(u: AuthUser, roomId: string, userId: string): Promise<void> {
    if (!UuidSchema.safeParse(userId).success || userId === u.userId) throw badUserId();
    const done = this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "remove");
      const ids = await rooms.activeMemberIds(tx, me, roomId);
      if (!ids.includes(userId)) throw userNotFound([userId]);
      await repo.markLeft(tx, me, roomId, userId);
      return { out: undefined, events: memberRemovedEvents(roomId, userId, without(ids, userId)) };
    });
    // X2b R17 · sau COMMIT huỷ run phòng của người bị bớt (`then`: kiểm 400 ở trên vẫn ném đồng bộ).
    return done.then(() => this.rooms.cancelRuns(u, roomId, userId));
  }

  /** R10 · thành viên rời; chủ còn người khác ⇒ `OWNER_MUST_TRANSFER`; chủ một mình ⇒ xoá phòng (D4). */
  async leave(u: AuthUser, roomId: string): Promise<void> {
    await this.rooms.commit(u, async (tx, me) => {
      const { role } = await lockFor(tx, me, roomId, "leave");
      const ids = await rooms.activeMemberIds(tx, me, roomId);
      const outcome = leaveOutcome(role, ids.length);
      if (outcome === "OWNER_MUST_TRANSFER") throw appError(outcome);
      let events: UserEvent[];
      if (outcome === "delete") {
        await rooms.softDeleteRoom(tx, me, roomId);
        events = deletedEvents(roomId, ids);
      } else {
        await repo.markLeft(tx, me, roomId, me.userId);
        events = memberRemovedEvents(roomId, me.userId, without(ids, me.userId));
      }
      return { out: undefined, events };
    });
    // R17 · chủ một mình rời ⇒ phòng xoá: chỉ còn run của chính mình.
    await this.rooms.cancelRuns(u, roomId, u.userId);
  }

  /** R11 · đích phải là thành viên hiện tại khác mình (không ⇒ 404 `USER_NOT_FOUND`); một câu `CASE` (D9). */
  transfer(u: AuthUser, roomId: string, to: string): Promise<RoomDetail> {
    return this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "transfer");
      const ids = await rooms.activeMemberIds(tx, me, roomId);
      if (to === me.userId || !ids.includes(to)) throw userNotFound([to]);
      await repo.transferOwner(tx, me, roomId, to);
      return {
        out: await loadDetail(tx, me, roomId),
        events: updatedEvents(roomId, ids, { owner_id: to }),
      };
    });
  }

  /**
   * R07 · ẩn DM của mình (đã ẩn ⇒ 204, không sự kiện); `room.unread` cho chính mình để đồng bộ tab (D15). Khoá phòng
   * trước (RV1 review #4) ⇒ tuần tự với gửi: tin commit trước thì cũ hơn `hidden_at`, gửi sau thì bỏ ẩn lại.
   */
  hide(u: AuthUser, roomId: string): Promise<void> {
    return this.rooms.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "hide");
      const hidden = await repo.hideSelf(tx, me, roomId);
      if (!hidden) return { out: undefined, events: [] };
      const total = await rooms.unreadTotal(tx, me);
      const ev: UserEvent = {
        userIds: [me.userId],
        event: "room.unread",
        data: { room_id: roomId, unread: hidden.unread, total },
      };
      return { out: undefined, events: [ev] };
    });
  }
}

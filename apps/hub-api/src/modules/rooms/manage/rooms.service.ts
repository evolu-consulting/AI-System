// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · nghiệp vụ phòng: tạo (DM/nhóm), danh sách, chi tiết, đổi tên, xoá (X2a plan §3,
// D3–D8; plan-db §5, §6). Mọi việc DB trong `withHubScope(user)`; không phải thành viên hiện tại ⇒ 404 `ROOM_NOT_FOUND`
// (R03). Mẫu outbox: transaction trả `{out, events}`, phát `ustream:*` SAU commit (R21, retry 40P01 không phát đôi).
import {
  type CreateRoomRequest,
  ROOM_MEMBERS_MAX,
  type RoomDetail,
  type RoomListQuery,
  type RoomListResponse,
  type RoomSummary,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import { deletedEvents, memberAddedEvents, updatedEvents } from "../room-events";
import { toRoomDetail, toRoomSummary } from "../rooms.map";
import {
  decodeRoomCursor,
  encodeRoomCursor,
  planCreateGroup,
  type RoomAction,
  type RoomRole,
  roomActionError,
} from "../rooms.rules";
import * as repo from "./rooms.repo";

export type RoomsDeps = { db: Db; redis?: Pick<Redis, "pipeline">; log: Pick<Logger, "warn"> };
export type Tracked<T> = { out: T; events: UserEvent[] };
type Me = repo.Me;

const meOf = (u: AuthUser): Me => ({ tenantId: u.tenantId, userId: u.userId });
/** SQLSTATE (DrizzleQueryError bọc lỗi driver ở `cause`, mẫu `lib/run-steps`). */
export const pgCode = (err: unknown): unknown => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
};
const roomNotFound = () => appError("ROOM_NOT_FOUND");
const userNotFound = (ids: string[]) => appError("USER_NOT_FOUND", { user_ids: ids });

/** Thứ tự kiểm plan §3: không phải thành viên ⇒ 404 → DM/ẩn nhóm ⇒ 409 → không phải chủ ⇒ 403. */
export function guard(row: repo.RoomAccessRow | null, action: RoomAction): repo.RoomAccessRow {
  if (!row) throw roomNotFound();
  const err = roomActionError(row.kind, row.role, action);
  if (err) throw appError(err);
  return row;
}

/**
 * Khoá hàng `rooms` (đầu tiên, plan-db §6) rồi kiểm lại quyền dưới khoá. Câu thứ hai là bắt buộc: READ COMMITTED lấy
 * snapshot đầu câu, nên câu `FOR UPDATE` sau khi chờ khoá vẫn thấy `room_members` cũ (vd. vai trò trước khi chuyển chủ).
 */
export async function lockFor(tx: Tx, me: Me, roomId: string, action: RoomAction) {
  await repo.findAccess(tx, me, roomId, true);
  return guard(await repo.findAccess(tx, me, roomId), action);
}

/** Chi tiết phòng như người gọi thấy (`members` = thành viên hiện tại). */
export async function loadDetail(tx: Tx, me: Me, roomId: string): Promise<RoomDetail> {
  const s = await repo.findSummary(tx, me, roomId);
  if (!s) throw roomNotFound();
  return toRoomDetail(s, await repo.activeMembers(tx, me, roomId), s.createdAt);
}

/** RoomSummary của thành viên khác (nhóm vừa tạo / người vừa được thêm): khác `my_role`; mốc đọc = `last_seq` (D6). */
export function summaryAs(d: RoomDetail, role: RoomRole): RoomSummary {
  const { owner_id: _o, created_at: _c, members: _m, ...summary } = d;
  return { ...summary, my_role: role, unread: 0 };
}

export class RoomsService {
  constructor(private readonly d: RoomsDeps) {}

  /** Ghi + phát sau commit. Lỗi Redis chỉ log trong `publishUserEvents`. */
  async commit<T>(u: AuthUser, fn: (tx: Tx, me: Me) => Promise<Tracked<T>>): Promise<T> {
    const me = meOf(u);
    const { out, events } = await withHubScope(this.d.db, { kind: "user", ...me }, (tx) =>
      fn(tx, me),
    );
    if (this.d.redis && events.length > 0)
      await publishUserEvents(this.d.redis, events, this.d.log);
    return out;
  }

  read<T>(u: AuthUser, fn: (tx: Tx, me: Me) => Promise<T>): Promise<T> {
    const me = meOf(u);
    return withHubScope(this.d.db, { kind: "user", ...me }, (tx) => fn(tx, me));
  }

  /** Route gọi trước khi parse body (404 trước 409/403 trước 400, plan §3). */
  async access(u: AuthUser, roomId: string, action: RoomAction): Promise<void> {
    await this.read(u, async (tx, me) => guard(await repo.findAccess(tx, me, roomId), action));
  }

  get(u: AuthUser, roomId: string): Promise<RoomDetail> {
    return this.read(u, (tx, me) => loadDetail(tx, me, roomId));
  }

  list(u: AuthUser, q: RoomListQuery): Promise<RoomListResponse> {
    const cursor = q.cursor === undefined ? undefined : decodeRoomCursor(q.cursor);
    if (cursor === null)
      throw validationError([{ path: ["cursor"], code: "custom", message: "Invalid cursor" }]);
    return this.read(u, async (tx, me) => {
      const rows = await repo.listSummaries(tx, me, { cursor, limit: q.limit });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const more = rows.length > q.limit && last;
      return {
        items: page.map(toRoomSummary),
        next_cursor: more ? encodeRoomCursor({ at: last.lastActivityAt, id: last.id }) : null,
        unread_total: await repo.unreadTotal(tx, me),
      };
    });
  }

  /** dm: 201 mới / 200 có sẵn (không sự kiện, D7) · group: 201 + `room.member_added` kèm `room` cho từng người (D15). */
  create(u: AuthUser, body: CreateRoomRequest): Promise<{ room: RoomDetail; created: boolean }> {
    if (body.kind === "dm") return this.createDm(u, body.user_id);
    return this.createGroup(u, body.name, body.member_ids);
  }

  private createDm(u: AuthUser, peer: string): Promise<{ room: RoomDetail; created: boolean }> {
    if (peer === u.userId) throw appError("DM_SELF");
    return this.commit(u, async (tx, me) => {
      if (!(await repo.usableUserIds(tx, me.tenantId, [peer])).has(peer))
        throw userNotFound([peer]);
      const res = await createOrPeerGone(tx, peer);
      if (!res.created) await repo.unhideSelf(tx, me, res.roomId);
      return {
        out: { room: await loadDetail(tx, me, res.roomId), created: res.created },
        events: [],
      };
    });
  }

  private createGroup(
    u: AuthUser,
    name: string,
    memberIds: readonly string[],
  ): Promise<{ room: RoomDetail; created: boolean }> {
    const plan = planCreateGroup(u.userId, memberIds);
    if (plan.full)
      throw appError("ROOM_FULL", { max: ROOM_MEMBERS_MAX, requested: plan.members.length + 1 });
    return this.commit(u, async (tx, me) => {
      const ok = await repo.usableUserIds(tx, me.tenantId, plan.members);
      const missing = plan.members.filter((id) => !ok.has(id));
      if (missing.length > 0) throw userNotFound(missing);
      const { roomId } = await repo.createRoom(tx, {
        id: crypto.randomUUID(),
        kind: "group",
        name,
        peer: null,
      });
      await repo.insertMembers(tx, me, roomId, plan.members);
      const room = await loadDetail(tx, me, roomId);
      const added = room.members.map((m) => ({ userId: m.id, room: summaryAs(room, m.role) }));
      return { out: { room, created: true }, events: memberAddedEvents(roomId, added, []) };
    });
  }

  rename(u: AuthUser, roomId: string, name: string): Promise<RoomDetail> {
    return this.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "rename");
      await repo.renameRoom(tx, me, roomId, name);
      const ids = await repo.activeMemberIds(tx, me, roomId);
      return {
        out: await loadDetail(tx, me, roomId),
        events: updatedEvents(roomId, ids, { name }),
      };
    });
  }

  remove(u: AuthUser, roomId: string): Promise<void> {
    return this.commit(u, async (tx, me) => {
      await lockFor(tx, me, roomId, "delete");
      const ids = await repo.activeMemberIds(tx, me, roomId);
      await repo.softDeleteRoom(tx, me, roomId);
      return { out: undefined, events: deletedEvents(roomId, ids) };
    });
  }
}

/** `create_room('dm')`; peer vừa bị khoá/xoá giữa lúc tra và lúc tạo ⇒ hàm ném P0002 ⇒ cùng `USER_NOT_FOUND`. */
async function createOrPeerGone(
  tx: Tx,
  peer: string,
): Promise<{ roomId: string; created: boolean }> {
  try {
    return await repo.createRoom(tx, { id: crypto.randomUUID(), kind: "dm", name: null, peer });
  } catch (err) {
    if (pgCode(err) === "P0002") throw userNotFound([peer]);
    throw err;
  }
}

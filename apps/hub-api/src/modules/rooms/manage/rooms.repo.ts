// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · truy vấn phòng (X2a plan-db §5 hàng Tạo/Đổi tên/Xoá/GET /rooms, §6). Chạy trong
// `withHubScope({kind:"user"})`: RLS (`is_room_member`) là lưới, mọi câu vẫn lọc `tenant_id` + người gọi tường minh.
// Khoá: `lockRoom` (FOR UPDATE OF r) LUÔN trước mọi ghi `room_members` (plan-db §6). Tạo phòng chỉ qua `hub.create_room` (D3).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { RoomMemberRow, RoomSummaryRow, UserRefRow } from "../rooms.map";
import type { RoomKind, RoomRole } from "../rooms.rules";

export type Me = { tenantId: string; userId: string };
export type RoomAccessRow = { kind: RoomKind; role: RoomRole };
export type SummaryWithCreated = RoomSummaryRow & { createdAt: Date };
export type ListPage = { cursor?: { at: Date; id: string }; limit: number };

type Ts = Date | string;
type Num = number | string;
const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));
/** id đã qua zod (uuid) ⇒ literal mảng Postgres an toàn (mẫu `attachments.repo`). */
const uuidArr = (ids: readonly string[]): string => `{${ids.join(",")}}`;

/** Phòng sống + vai trò của người gọi (thành viên hiện tại). `lock` ⇒ khoá hàng `rooms` (thứ tự khoá §6). */
export async function findAccess(
  tx: Tx,
  me: Me,
  roomId: string,
  lock = false,
): Promise<RoomAccessRow | null> {
  const rows = await tx.execute<RoomAccessRow>(sql`
    select r.kind, m.role
    from hub.rooms r
    join hub.room_members m on m.room_id = r.id and m.user_id = ${me.userId} and m.left_at is null
    where r.id = ${roomId} and r.tenant_id = ${me.tenantId} and r.deleted_at is null
    ${lock ? sql`for update of r` : sql``}`);
  return rows[0] ?? null;
}

/** R01/R02 · trong `ids`, những người cùng tenant + đang dùng được (active, không bị tenant khoá). */
export async function usableUserIds(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select u.id from admin.users u
    where u.tenant_id = ${tenantId} and u.active and not u.locked_by_tenant
      and u.id = any(${uuidArr(ids)}::uuid[])`);
  return new Set(rows.map((r) => r.id));
}

/** D3 · `hub.create_room` (tenant/user lấy từ GUC trong hàm). DM trùng ⇒ `created=false` + id phòng có sẵn. */
export async function createRoom(
  tx: Tx,
  p: { id: string; kind: RoomKind; name: string | null; peer: string | null },
): Promise<{ roomId: string; created: boolean }> {
  const [row] = await tx.execute<{ room_id: string; created: boolean }>(sql`
    select room_id, created from hub.create_room(${p.id}::uuid, ${p.kind}, ${p.name}::text, ${p.peer}::uuid)`);
  if (!row) throw new Error("create_room returned no row");
  return { roomId: row.room_id, created: row.created };
}

/** Tạo nhóm: thành viên thường, mốc đọc = `last_seq` lúc vào (D6). Chạy sau `create_room` (chủ đã có ⇒ policy INSERT qua). */
export async function insertMembers(
  tx: Tx,
  me: Me,
  roomId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
    select r.id, r.tenant_id, u.id, 'member', r.created_at, r.last_seq
    from hub.rooms r, unnest(${uuidArr(ids)}::uuid[]) as u(id)
    where r.id = ${roomId} and r.tenant_id = ${me.tenantId}`);
}

/** R07 · mở lại DM qua `POST /rooms` ⇒ hết ẩn (chỉ hàng của mình). */
export async function unhideSelf(tx: Tx, me: Me, roomId: string): Promise<void> {
  await tx.execute(sql`
    update hub.room_members set hidden_at = null
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and user_id = ${me.userId} and hidden_at is not null`);
}

type SummarySqlRow = {
  id: string;
  kind: RoomKind;
  name: string | null;
  last_seq: Num;
  last_activity_at: Ts;
  created_at: Ts;
  role: RoomRole;
  last_read_seq: Num;
  member_count: Num;
  peer_id: string | null;
  peer_name: string | null;
  peer_username: string | null;
  lm_seq: Num | null;
  lm_type: "user" | "agent" | null;
  lm_sender: string | null;
  lm_content: string | null;
  lm_at: Ts | null;
  lm_name: string | null;
  lm_username: string | null;
};

const ref = (id: string, displayName: string | null, username: string | null): UserRefRow => ({
  id,
  displayName,
  username,
});

function toSummaryRow(r: SummarySqlRow): SummaryWithCreated {
  const last =
    r.lm_seq === null || r.lm_type === null || r.lm_content === null || r.lm_at === null
      ? null
      : {
          seq: Number(r.lm_seq),
          senderType: r.lm_type,
          sender: ref(r.lm_sender ?? r.id, r.lm_name, r.lm_username),
          content: r.lm_content,
          createdAt: toDate(r.lm_at),
        };
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    peer: r.peer_id === null ? null : ref(r.peer_id, r.peer_name, r.peer_username),
    memberCount: Number(r.member_count),
    myRole: r.role,
    lastSeq: Number(r.last_seq),
    lastReadSeq: Number(r.last_read_seq),
    lastActivityAt: toDate(r.last_activity_at),
    createdAt: toDate(r.created_at),
    last,
  };
}

/** Một câu: membership của mình ⨝ phòng sống, peer (DM), số thành viên, tin cuối (`seq = last_seq`, unique). */
async function summaries(tx: Tx, me: Me, filter: SQL, tail: SQL): Promise<SummaryWithCreated[]> {
  const rows = await tx.execute<SummarySqlRow>(sql`
    select r.id, r.kind, r.name, r.last_seq, r.last_activity_at, r.created_at, m.role, m.last_read_seq,
      (select count(*) from hub.room_members c where c.room_id = r.id and c.left_at is null) as member_count,
      pm.user_id as peer_id, pu.display_name as peer_name, pu.username as peer_username,
      lm.seq as lm_seq, lm.sender_type as lm_type, lm.sender_id as lm_sender, lm.content as lm_content,
      lm.created_at as lm_at, su.display_name as lm_name, su.username as lm_username
    from hub.room_members m
    join hub.rooms r on r.id = m.room_id and r.tenant_id = m.tenant_id and r.deleted_at is null
    left join lateral (select p.user_id from hub.room_members p
      where r.kind = 'dm' and p.room_id = r.id and p.user_id <> m.user_id limit 1) pm on true
    left join admin.users pu on pu.id = pm.user_id and pu.tenant_id = m.tenant_id
    left join hub.room_messages lm on lm.room_id = r.id and lm.seq = r.last_seq
    left join admin.users su on su.id = lm.sender_id and su.tenant_id = m.tenant_id
    where m.user_id = ${me.userId} and m.tenant_id = ${me.tenantId} and m.left_at is null ${filter}
    ${tail}`);
  return rows.map(toSummaryRow);
}

/** Một phòng (kể cả DM đang ẩn / DM chưa có tin — người gọi vẫn là thành viên, I14). */
export async function findSummary(
  tx: Tx,
  me: Me,
  roomId: string,
): Promise<SummaryWithCreated | null> {
  const [row] = await summaries(tx, me, sql`and r.id = ${roomId}`, sql``);
  return row ?? null;
}

/**
 * `GET /rooms` (plan-db §5): bỏ phòng mình ẩn, bỏ DM chưa có tin mà mình không tạo (D7); keyset `(last_activity_at, id)`
 * giảm dần. Lấy `limit + 1` để biết còn trang.
 */
export async function listSummaries(tx: Tx, me: Me, page: ListPage): Promise<SummaryWithCreated[]> {
  const after = page.cursor
    ? sql`and (r.last_activity_at, r.id) < (${page.cursor.at.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`
    : sql``;
  const filter = sql`and m.hidden_at is null
    and not (r.kind = 'dm' and r.last_seq = 0 and r.created_by <> ${me.userId}) ${after}`;
  return summaries(
    tx,
    me,
    filter,
    sql`order by r.last_activity_at desc, r.id desc limit ${page.limit + 1}`,
  );
}

/** R17 · tổng chưa đọc trên phòng đang hiện (cùng công thức `hub.room_fanout`). */
export async function unreadTotal(tx: Tx, me: Me): Promise<number> {
  const [row] = await tx.execute<{ n: Num }>(sql`
    select coalesce(sum(greatest(r.last_seq - m.last_read_seq, 0)), 0) as n
    from hub.room_members m
    join hub.rooms r on r.id = m.room_id and r.tenant_id = m.tenant_id and r.deleted_at is null
    where m.user_id = ${me.userId} and m.tenant_id = ${me.tenantId} and m.left_at is null and m.hidden_at is null`);
  return Number(row?.n ?? 0);
}

type MemberSqlRow = {
  user_id: string;
  role: RoomRole;
  last_read_seq: Num;
  joined_at: Ts;
  display_name: string | null;
  username: string | null;
};

/** Thành viên hiện tại (chủ trước). */
export async function activeMembers(tx: Tx, me: Me, roomId: string): Promise<RoomMemberRow[]> {
  const rows = await tx.execute<MemberSqlRow>(sql`
    select m.user_id, m.role, m.last_read_seq, m.joined_at, u.display_name, u.username
    from hub.room_members m
    left join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} and m.left_at is null
    order by (m.role = 'owner') desc, m.joined_at, m.user_id`);
  return rows.map((r) => ({
    user: ref(r.user_id, r.display_name, r.username),
    role: r.role,
    lastReadSeq: Number(r.last_read_seq),
    joinedAt: toDate(r.joined_at),
  }));
}

/** Id thành viên hiện tại — người nhận sự kiện (đọc SAU khi giữ khoá phòng, R20). */
export async function activeMemberIds(tx: Tx, me: Me, roomId: string): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select user_id from hub.room_members
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and left_at is null`);
  return rows.map((r) => r.user_id);
}

export async function renameRoom(tx: Tx, me: Me, roomId: string, name: string): Promise<void> {
  await tx.execute(sql`
    update hub.rooms set name = ${name} where id = ${roomId} and tenant_id = ${me.tenantId}`);
}

/** D4 · xoá = `deleted_at` + `left_at` cho mọi thành viên còn lại, cùng transaction (rooms trước, room_members sau). */
export async function softDeleteRoom(tx: Tx, me: Me, roomId: string): Promise<void> {
  await tx.execute(sql`
    update hub.rooms set deleted_at = date_trunc('milliseconds', now())
    where id = ${roomId} and tenant_id = ${me.tenantId} and deleted_at is null`);
  await tx.execute(sql`
    update hub.room_members set left_at = date_trunc('milliseconds', now())
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and left_at is null`);
}

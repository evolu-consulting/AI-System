// HUB-FR-96 · seed dev phòng chat (X2a plan-db §4.6, tasks B8, test-plan Z01): `acme` DM `lan`–`hoa` (3 tin) + nhóm
// "Nhóm dự án"; `evolu` nhóm "Evolu team" (5 người, julian.bui chủ) + DM julian.bui–thomas.tran.
// Phòng tạo QUA `hub.create_room` (đặt GUC app.scope/tenant_id/user_id như `withHubScope`), không INSERT thẳng `hub.rooms`;
// thành viên thêm của nhóm + tin nhắn do owner DB ghi (RLS không chặn owner). Idempotent: id nhóm cố định, DM theo `dm_key`
// (create_room trả phòng có sẵn), tin chỉ ghi khi phòng chưa có tin, thành viên `ON CONFLICT DO NOTHING`.
import postgres from "postgres";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
type Msg = { from: string; text: string };
type RoomSpec =
  | { kind: "dm"; a: string; b: string; msgs: Msg[] }
  | { kind: "group"; id: string; name: string; owner: string; members: string[]; msgs: Msg[] };

const gid = (n: number) => `d2a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ACME: RoomSpec[] = [
  {
    kind: "dm",
    a: "lan",
    b: "hoa",
    msgs: [
      { from: "lan", text: "Chào Hoa, bạn xem giúp mình bản kế hoạch nhé." },
      { from: "hoa", text: "Ok Lan, mình xem ngay." },
      { from: "hoa", text: "Có vài chỗ cần chỉnh, mình ghi chú rồi." },
    ],
  },
  {
    kind: "group",
    id: gid(1),
    name: "Nhóm dự án",
    owner: "lan",
    members: ["hoa"],
    msgs: [
      { from: "lan", text: "Chào cả nhóm, đây là phòng trao đổi dự án." },
      { from: "hoa", text: "Đã vào nhóm." },
    ],
  },
];

/** Phòng demo `evolu` (người dùng yêu cầu 2026-10-08): không có tin, để trống cho người thật nhắn. */
const EVOLU: RoomSpec[] = [
  { kind: "dm", a: "julian.bui", b: "thomas.tran", msgs: [] },
  {
    kind: "group",
    id: gid(2),
    name: "Evolu team",
    owner: "julian.bui",
    members: ["thomas.tran", "vio.ngo", "edgar.nguyen", "rowan.hoang"],
    msgs: [],
  },
];

async function users(
  sql: Sql,
  tenantKey: string,
): Promise<{ tid: string; byName: Map<string, string> } | null> {
  const rows = await sql<{ tid: string; id: string; username: string }[]>`
    select t.id as tid, u.id, u.username from admin.tenants t join admin.users u on u.tenant_id = t.id
    where t.key = ${tenantKey}`;
  const first = rows[0];
  if (!first) return null;
  return { tid: first.tid, byName: new Map(rows.map((r) => [r.username, r.id])) };
}

const scope = (tx: Tx, tid: string, uid: string) =>
  tx`select set_config('app.scope', 'user', true), set_config('app.tenant_id', ${tid}, true),
       set_config('app.user_id', ${uid}, true)`;

async function createRoom(
  tx: Tx,
  spec: RoomSpec,
  tid: string,
  id: (n: string) => string,
): Promise<string | null> {
  const caller = id(spec.kind === "dm" ? spec.a : spec.owner);
  await scope(tx, tid, caller);
  const rid = spec.kind === "dm" ? crypto.randomUUID() : spec.id;
  const peer = spec.kind === "dm" ? id(spec.b) : null;
  const name = spec.kind === "group" ? spec.name : null;
  if (spec.kind === "group") {
    const [hit] = await tx`select id from hub.rooms where id = ${rid}`;
    if (hit) return rid;
  }
  const [r] = await tx<{ room_id: string }[]>`
    select room_id from hub.create_room(${rid}::uuid, ${spec.kind}, ${name}, ${peer}::uuid)`;
  return r?.room_id ?? null;
}

async function seedMessages(
  tx: Tx,
  rid: string,
  msgs: Msg[],
  ctx: { tid: string; id: (n: string) => string },
) {
  const [row] = await tx<
    { n: number }[]
  >`select count(*)::int as n from hub.room_messages where room_id = ${rid}`;
  const { tid, id } = ctx;
  if ((row?.n ?? 0) > 0 || msgs.length === 0) return;
  const base = Date.now() - msgs.length * 60_000;
  for (const [i, m] of msgs.entries()) {
    const at = new Date(base + i * 60_000);
    await tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
      values (${rid}, ${tid}, ${i + 1}, 'user', ${id(m.from)}, ${m.text}, ${at})`;
  }
  const last = new Date(base + (msgs.length - 1) * 60_000);
  await tx`update hub.rooms set last_seq = ${msgs.length}, last_activity_at = ${last} where id = ${rid}`;
  // người gửi tin cuối coi như đã đọc đến cuối; người khác giữ chưa đọc
  for (const u of new Set(msgs.map((m) => m.from)))
    await tx`update hub.room_members set last_read_seq = ${msgs.map((m) => m.from).lastIndexOf(u) + 1}
      where room_id = ${rid} and user_id = ${id(u)}`;
}

async function seedRoom(sql: Sql, spec: RoomSpec, tid: string, id: (n: string) => string) {
  await sql.begin(async (tx) => {
    const rid = await createRoom(tx, spec, tid, id);
    if (!rid) throw new Error("create_room không trả phòng");
    if (spec.kind === "group")
      for (const m of spec.members)
        await tx`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
          values (${rid}, ${tid}, ${id(m)}, 'member', now(), 0) on conflict (room_id, user_id) do nothing`;
    await seedMessages(tx, rid, spec.msgs, { tid, id });
  });
}

async function seedTenant(sql: Sql, tenantKey: string, specs: RoomSpec[]): Promise<boolean> {
  const t = await users(sql, tenantKey);
  if (!t) return false;
  const id = (name: string) => {
    const v = t.byName.get(name);
    if (!v) throw new Error(`tenant ${tenantKey} thiếu user ${name}`);
    return v;
  };
  for (const spec of specs) await seedRoom(sql, spec, t.tid, id);
  return true;
}

/** Seam Z01 (test-plan §9 G13): phòng mẫu `acme`. `ownerUrl` = DATABASE_URL (owner). Không có tenant ⇒ bỏ qua. */
export async function ensureFixtureRooms(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await seedTenant(sql, "acme", ACME);
  } finally {
    await sql.end();
  }
}

/** Phòng demo `evolu`: nhóm "Evolu team" (5 người) + DM julian.bui–thomas.tran. Trả false nếu chưa có tenant. */
export async function ensureDemoRooms(ownerUrl: string): Promise<boolean> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    return await seedTenant(sql, "evolu", EVOLU);
  } finally {
    await sql.end();
  }
}

// my-activity-rag · SQL lõi cho `my-chat-history` + phần audit của `my-activity`. Gọi TRONG `withHubScope({kind:"user"})` của
// NGƯỜI GỌI: `hub.messages/conversations/flows` có RLS (tenant + user) ⇒ chỉ tin của chính người đó; vẫn lọc `tenant_id`/
// `user_id` tường minh. `hub.audit_log` không RLS ⇒ lọc `tenant_id` + `actor_id` = người gọi. Audit Admin chỉ qua hàm
// `hub.my_admin_audit` (0050, SECURITY DEFINER, lấy người từ `app.*` của tx) — hub không có quyền đọc bảng đó.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { CHAT_CANDIDATES, CHAT_RECENT_SCAN } from "./my-history.rules";

const ISO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS"Z"'`);
const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', ${ISO})`;

export type Who = { tenantId: string; userId: string };
export type DayWindow = { from: string | null; to: string | null; tz: string };

const lower = (w: DayWindow) =>
  sql`coalesce((${w.from}::date)::timestamp at time zone ${w.tz}, '-infinity'::timestamptz)`;
const upper = (w: DayWindow) =>
  sql`coalesce(((${w.to}::date) + 1)::timestamp at time zone ${w.tz}, 'infinity'::timestamptz)`;

/**
 * Giá trị thô `admin.tenants.settings.chat_history_months` (luật `retentionMonths` kiểm). Cùng câu đặt kế hoạch cố định cho
 * tx (Luật 4c — không phụ thuộc thống kê): tắt JIT (như `withPackScope`: biên dịch hàng chục–trăm ms cho câu vài ms), tắt seq
 * scan + bitmap scan ⇒ bước quét tin luôn đi index `(tenant_id, user_id, created_at DESC)` theo thứ tự và dừng ở LIMIT. Đo
 * 100k tin/người: policy RLS (OR + current_setting) làm ước lượng còn ~250 hàng ⇒ planner chọn seq scan + sort (870 ms) hoặc
 * vòng lồng theo flows (9 s). Tắt song song (khởi động worker ~9 ms > việc). Pha 2 (GIN) bật lại bitmap scan trước câu của nó.
 */
export async function retentionRaw(tx: Tx, tenantId: string): Promise<unknown> {
  const r = await tx.execute<{ m: string | null }>(
    sql`select set_config('jit', 'off', true) as j, set_config('enable_seqscan', 'off', true) as s,
      set_config('enable_bitmapscan', 'off', true) as b, set_config('max_parallel_workers_per_gather', '0', true) as p,
      (select t.settings ->> 'chat_history_months' from admin.tenants t where t.id = ${tenantId}::uuid) as m`,
  );
  return r[0]?.m ?? null;
}

export type ChatSearch = DayWindow & {
  months: number;
  tsq: string | null;
  roles: readonly string[];
  /** Run đang gọi tool (uuid) ⇒ bỏ chính câu hỏi/trả lời đang chạy. */
  excludeRun: string | null;
  limit: number;
};
export type ChatHitRow = {
  id: string;
  role: "user" | "assistant";
  at: string;
  conversation_id: string;
  flow_id: string;
  room_id: string | null;
  title: string;
  content: string;
};

/** Điều kiện trên tin: chủ tin, vai, hạn lưu, khoảng ngày, bỏ câu hỏi/trả lời của run đang gọi tool. */
function msgWhere(who: Who, q: ChatSearch): SQL {
  return sql`m.tenant_id = ${who.tenantId}::uuid and m.user_id = ${who.userId}::uuid
    and m.role = any(string_to_array(${q.roles.join(",")}::text, ','))
    and m.created_at >= greatest(now() - make_interval(months => ${q.months}::int), ${lower(q)})
    and m.created_at < ${upper(q)}
    and m.id <> all(coalesce((select array[r.user_message_id, r.answer_message_id] from hub.runs r
      where r.id = ${q.excludeRun}::uuid), '{}'::uuid[]))`;
}
/** Hội thoại còn: không xoá, không phải hội thoại nền của quy trình. */
const CONV_OK = sql`v.deleted_at is null and v.process_run_id is null`;

const SELECT_HIT = sql`select m.id, m.role, ${iso(sql`m.created_at`)} as at, m.conversation_id,
    m.flow_id, v.room_id, coalesce(nullif(f.title, ''), v.title) as title, left(m.content, 4000) as content`;

/** Hội thoại của tin `x` còn (tra PK từng hàng — không để planner quét CTE lặp theo hội thoại). */
const convAlive = (x: string) => sql`exists (select 1 from hub.conversations v
  where v.id = ${sql.raw(x)}.conversation_id and ${CONV_OK})`;

/**
 * Xếp `ts_rank` × độ mới trên ứng viên `cand(id, created_at, search_tsv)`, lấy `limit`, kèm hội thoại/luồng. `ts_rank` (không
 * `_cd`): đo 200 ứng viên × tsquery OR 7 từ, `ts_rank_cd` tốn ~50 ms.
 */
const ranked = (query: SQL, limit: number) => sql`top as (
      select c.id, c.created_at,
        ts_rank(c.search_tsv, ${query}) / (1 + extract(epoch from now() - c.created_at) / 2592000.0) as score
      from cand c order by score desc, c.created_at desc limit ${limit}::int)
    ${SELECT_HIT}
    from top t join hub.messages m on m.id = t.id
    join hub.conversations v on v.id = m.conversation_id join hub.flows f on f.id = m.flow_id
    order by t.score desc, t.created_at desc`;

/**
 * Pha 1 (kế hoạch cố định, không phụ thuộc thống kê): quét `CHAT_RECENT_SCAN` tin mới nhất qua index thời gian rồi lọc `@@`
 * (từ khoá phổ biến ⇒ đủ kết quả ở đây, chi phí chặn trên).
 */
async function recentMatches(tx: Tx, who: Who, q: ChatSearch, query: SQL): Promise<ChatHitRow[]> {
  const rows = await tx.execute<ChatHitRow>(sql`with w as materialized (
      select m.id, m.created_at, m.search_tsv, m.conversation_id from hub.messages m
      where ${msgWhere(who, q)} order by m.created_at desc limit ${CHAT_RECENT_SCAN}::int),
    x as materialized (select w.id, w.created_at, w.search_tsv, w.conversation_id from w where w.search_tsv @@ ${query}),
    cand as (
      select x.id, x.created_at, x.search_tsv from x where ${convAlive("x")}
      order by x.created_at desc limit ${CHAT_CANDIDATES}::int),
    ${ranked(query, q.limit)}`);
  return [...rows];
}

/**
 * Pha 2 (khi pha 1 thiếu — từ khoá hiếm / tin cũ): GIN `(user_id, search_tsv)` lấy mọi tin khớp của người gọi (ít), rồi lọc
 * đủ điều kiện + ≤ CHAT_CANDIDATES mới nhất.
 */
async function olderMatches(tx: Tx, who: Who, q: ChatSearch, query: SQL): Promise<ChatHitRow[]> {
  await tx.execute(sql`select set_config('enable_bitmapscan', 'on', true)`); // GIN chỉ đọc được qua bitmap
  const rows = await tx.execute<ChatHitRow>(sql`with h as materialized (
      select m.id from hub.messages m where m.user_id = ${who.userId}::uuid and m.search_tsv @@ ${query}),
    cand as (
      select m.id, m.created_at, m.search_tsv from h join hub.messages m on m.id = h.id
      where ${msgWhere(who, q)} and ${convAlive("m")} order by m.created_at desc limit ${CHAT_CANDIDATES}::int),
    ${ranked(query, q.limit)}`);
  return [...rows];
}

/** Có từ khoá: pha 1; chưa đủ `limit` ⇒ pha 2 (bao trùm pha 1). Tối đa 2 câu. */
async function byKeywords(tx: Tx, who: Who, q: ChatSearch, tsq: string): Promise<ChatHitRow[]> {
  const query = sql`to_tsquery('hub.vi', ${tsq})`;
  const first = await recentMatches(tx, who, q, query);
  return first.length >= q.limit ? first : olderMatches(tx, who, q, query);
}

/** Không từ khoá: tin mới nhất trong khoảng (index `(tenant_id, user_id, created_at DESC)`). */
async function recent(tx: Tx, who: Who, q: ChatSearch): Promise<ChatHitRow[]> {
  const rows = await tx.execute<ChatHitRow>(sql`with w as materialized (
      select m.id, m.created_at from hub.messages m where ${msgWhere(who, q)}
      order by m.created_at desc limit ${CHAT_CANDIDATES}::int)
    ${SELECT_HIT}
    from w join hub.messages m on m.id = w.id
    join hub.conversations v on v.id = m.conversation_id join hub.flows f on f.id = m.flow_id
    where ${CONV_OK}
    order by w.created_at desc limit ${q.limit}::int`);
  // ≤ CHAT_CANDIDATES tin mới nhất rồi mới lọc hội thoại còn: người xoá > CHAT_CANDIDATES tin gần nhất chỉ thấy ít hơn (chấp nhận, chi phí chặn trên).
  return [...rows];
}

export const searchChat = (tx: Tx, who: Who, q: ChatSearch): Promise<ChatHitRow[]> =>
  q.tsq ? byKeywords(tx, who, q, q.tsq) : recent(tx, who, q);

export type SysRow = {
  at: string;
  source: "hub" | "admin";
  action: string;
  entity: string;
  name: string;
};
export type AuditWindow = DayWindow & { action: string | null; limit: number };

/** Audit Hub (Studio/agent…) + Admin do CHÍNH người gọi làm, mới nhất trước. 2 câu. */
export async function myAudit(tx: Tx, who: Who, w: AuditWindow): Promise<SysRow[]> {
  const act = w.action ?? "%";
  const hub =
    await tx.execute<SysRow>(sql`select ${iso(sql`a.at`)} as at, 'hub' as source, a.action,
      a.entity, a.entity_name as name
    from hub.audit_log a
    where a.tenant_id = ${who.tenantId}::uuid and a.actor_id = ${who.userId}::uuid
      and a.at >= ${lower(w)} and a.at < ${upper(w)} and a.action like ${act}
    order by a.seq desc limit ${w.limit}::int`);
  const adm =
    await tx.execute<SysRow>(sql`select ${iso(sql`a.at`)} as at, 'admin' as source, a.action,
      a.entity, a.entity_name as name
    from hub.my_admin_audit(${lower(w)}, ${upper(w)}, ${act}, ${w.limit}::int) a`);
  return [...hub, ...adm];
}

/** Tên hiển thị của người trong CÙNG tenant (cột hub_ro được SELECT). 1 câu. */
export async function userNames(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name: string }>(sql`select u.id,
      coalesce(nullif(u.display_name, ''), u.username) as name
    from admin.users u where u.tenant_id = ${tenantId}::uuid
      and u.id = any(string_to_array(${ids.join(",")}::text, ',')::uuid[])`);
  return new Map([...rows].map((r) => [r.id, r.name]));
}

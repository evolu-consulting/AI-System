// V2-K · TQ-01 · BA v2 §5.9 (8 nguồn Cần xử lý): MỘT câu SQL văn bản cố định cho cả danh sách — mỗi nguồn ≤ `LIM` hàng (dư một ⇒ bị
// cắt), lọc `tenant_id` tường minh ngoài RLS. Tx do `PackUow` mở (RLS tenant + luật thấy M1): mốc / HĐ / khách đang dùng của HĐ người
// dùng không thấy không bao giờ vào. Việc người dùng đã Bỏ qua / Đã xong (`todo_dismissals`, của riêng mình) bị loại theo khoá
// `<loại>:<uuid>:<ngày>`. "Mình" = `app.user_id` của tx (từ token).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { TodoWindow } from "../application/overview.ports";
import type { RawTodo, TodoAction } from "../domain/todo.rules";
import { TODO_SOURCE_MAX } from "../domain/todo.rules";
import { CONFIRMED_STATUSES, confirmedOf, one } from "./ledger-sql";

const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;
const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const LIM = TODO_SOURCE_MAX + 1;
const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));
/** Tên HĐ + đối tác (bên kia) của bí danh `c`. */
const TITLE = (c: string) =>
  sql.raw(`coalesce(nullif(${c}.fields -> 'title' ->> 'value', ''), ${c}.number, ${c}.title)`);
const PARTY = (c: string) =>
  sql.raw(`case when ${c}.direction = 'purchase' then ${c}.seller else ${c}.buyer end`);
/** Số ngày nhắc của HĐ `c` (0…3650) ?? mặc định Cài đặt (V2-H) ?? 60. */
const NOTICE = (
  c: string,
  t: string,
) => sql`coalesce((select n from (select contracts.as_bigint(${sql.raw(c)}.fields
    -> 'notice_days' ->> 'value') as n) s where n between 0 and 3650),
  (select b.renewal_notice_days from contracts.business_settings b where b.tenant_id = ${t}::uuid), 60)`;
const notDismissed = (
  t: string,
  key: ReturnType<typeof sql>,
) => sql`not exists (select 1 from contracts.todo_dismissals x
    where x.tenant_id = ${t}::uuid and x.user_id = ${ME} and x.item_key = ${key})`;
const k = (kind: string, id: string, day: string) =>
  sql.raw(`'${kind}:' || ${id}::text || ':' || to_char(${day}, 'YYYY-MM-DD')`);

export type { TodoWindow };

const sources = (t: string, w: TodoWindow) => sql`with ${dueSources(t, w)}, ${fileSources(t, w)}`;

/** Nguồn hạn: mốc, hoa hồng, HĐ sắp hết, khách sắp hết, liên hệ gia hạn. */
const dueSources = (t: string, w: TodoWindow) => sql`
  ms as (select o.id, o.contract_id, o.kind, o.direction, o.amount, o.title, o.due_date from contracts.obligations o
    where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind not in ('renewal', 'commission')
      and o.due_date <= ${w.horizon}::date and ${confirmedOf("o", t)}
      and ${notDismissed(t, sql`${k("milestone", "o.id", "o.due_date")}`)}
    order by o.due_date, o.id limit ${LIM}::int),
  cm as (select o.id, o.contract_id, o.amount, o.title, o.due_date from contracts.obligations o
    where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'commission' and o.due_date < ${w.today}::date
      and ${confirmedOf("o", t)} and ${notDismissed(t, sql`${k("commission", "o.id", "o.due_date")}`)}
    order by o.due_date, o.id limit ${LIM}::int),
  ce as (select c.id, c.end_date, c.fields, c.number, c.title, c.direction, c.seller, c.buyer from contracts.contracts c
    where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.status in ('active', 'expiring') and c.handled is null
      and c.superseded_at is null
      and c.end_date between ${w.today}::date and ${w.today}::date + 3650
      and c.end_date - ${NOTICE("c", t)}::int <= ${w.today}::date
      and ${notDismissed(t, sql`${k("contract_expiring", "c.id", "c.end_date")}`)}
    order by c.end_date, c.id limit ${LIM}::int),
  cu as (select s.product_id, count(*)::int as n, min(s.expires_on) as due from contracts.service_customers s
      join contracts.contracts c on c.tenant_id = s.tenant_id and c.id = s.contract_id
    where s.tenant_id = ${t}::uuid and s.expires_on between ${w.today}::date and ${w.today}::date + 3650
      and s.expires_on - ${NOTICE("c", t)}::int <= ${w.today}::date
    group by s.product_id),
  cux as (select cu.*, p.name from cu join contracts.products p on p.tenant_id = ${t}::uuid and p.id = cu.product_id
    where ${notDismissed(t, sql`${k("customers_expiring", "cu.product_id", "cu.due")}`)}
    order by cu.due, cu.product_id limit ${LIM}::int),
  rc as (select g.id, g.title, g.contract_id, (g.due_at at time zone ${w.tz}::text)::date as due,
      case when g.subject_id ~ ${UUID_RE} then g.subject_id::uuid end as sc_id
    from contracts.followups g
    where g.tenant_id = ${t}::uuid and g.user_id = ${ME} and g.status <> 'done' and g.subject_kind = 'renewal'
    order by g.due_at, g.id limit ${LIM}::int)`;

/** HĐ thiếu file + cảnh báo giá. CR-097 U3: bỏ việc "Đánh giá đối tác" (hết ô chấm sao, R41). */
const fileSources = (t: string, w: TodoWindow) => sql`
  mf as (select c.id, (c.created_at at time zone 'UTC')::date as day, c.fields, c.number, c.title, c.direction,
      c.seller, c.buyer from contracts.contracts c
    where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.status in (${CONFIRMED}) and c.file_id is null
      and c.superseded_at is null
      and ${notDismissed(t, sql`${k("missing_file", "c.id", "(c.created_at at time zone 'UTC')::date")}`)}
    order by c.created_at desc, c.id limit ${LIM}::int),
  pa as (select a.id, a.product_id, a.day, a.detail, a.supplier_name, a.price, p.name
    from contracts.price_scout_alerts a join contracts.products p on p.tenant_id = ${t}::uuid and p.id = a.product_id
    where a.tenant_id = ${t}::uuid and a.day >= ${w.today}::date - 30
      and ${notDismissed(t, sql`${k("market_price", "a.id", "a.day")}`)}
    order by a.day desc, a.id limit ${LIM}::int)`;

/** Mọi nguồn ⇒ MỘT mảng hàng đồng dạng (`RawTodo`). */
const payload = (t: string) => sql`select coalesce(jsonb_agg(x.j), '[]'::jsonb) as j from (
  select jsonb_build_object('kind', 'milestone', 'id', m.id, 'due', m.due_date, 'title', coalesce(m.title, ${TITLE("c")}),
      'sub', ${TITLE("c")}, 'party', ${PARTY("c")}, 'amount', m.amount, 'contract_id', m.contract_id, 'milestone_id', m.id,
      'direction', m.direction) as j
    from ms m left join contracts.contracts c on c.tenant_id = ${t}::uuid and c.id = m.contract_id
  union all
  select jsonb_build_object('kind', 'commission', 'id', m.id, 'due', m.due_date, 'title', coalesce(m.title, 'Nhận hoa hồng'),
      'sub', ${TITLE("c")}, 'party', ${PARTY("c")}, 'amount', m.amount, 'contract_id', m.contract_id, 'milestone_id', m.id,
      'product_id', (select i.product_id from contracts.contract_items i where i.tenant_id = ${t}::uuid
        and i.contract_id = m.contract_id and i.product_id is not null order by i.ord limit 1))
    from cm m left join contracts.contracts c on c.tenant_id = ${t}::uuid and c.id = m.contract_id
  union all
  select jsonb_build_object('kind', 'contract_expiring', 'id', c.id, 'due', c.end_date, 'title', ${TITLE("c")},
      'party', ${PARTY("c")}, 'contract_id', c.id) from ce c
  union all
  select jsonb_build_object('kind', 'customers_expiring', 'id', u.product_id, 'due', u.due, 'title', u.name,
      'count', u.n, 'product_id', u.product_id) from cux u
  union all
  select jsonb_build_object('kind', 'renewal_contact', 'id', r.id, 'due', r.due, 'title', r.title,
      'contract_id', coalesce(r.contract_id, s.contract_id), 'product_id', s.product_id, 'party', s.customer_name,
      'followup_id', r.id)
    from rc r left join contracts.service_customers s on s.tenant_id = ${t}::uuid and s.id = r.sc_id
  union all
  select jsonb_build_object('kind', 'missing_file', 'id', c.id, 'due', c.day, 'title', ${TITLE("c")},
      'party', ${PARTY("c")}, 'contract_id', c.id) from mf c
  union all
  select jsonb_build_object('kind', 'market_price', 'id', a.id, 'due', a.day, 'title', a.name, 'sub', a.detail,
      'party', a.supplier_name, 'amount', a.price, 'product_id', a.product_id) from pa a) x`;

export function todoRepo(tx: Tx, t: string) {
  return {
    list: (w: TodoWindow) => one<RawTodo[]>(tx, sql`${sources(t, w)} ${payload(t)}`),
    /** Bỏ qua / Đã xong: việc suy ra ⇒ ghi khoá của riêng mình (đặt lại = cập nhật). */
    dismiss: async (key: string, action: TodoAction) => {
      await tx.execute(sql`insert into contracts.todo_dismissals (tenant_id, user_id, item_key, action)
        values (${t}::uuid, ${ME}, ${key}, ${action})
        on conflict (tenant_id, user_id, item_key) do update set action = excluded.action, at = now()`);
    },
  };
}
export type TodoRepo = ReturnType<typeof todoRepo>;

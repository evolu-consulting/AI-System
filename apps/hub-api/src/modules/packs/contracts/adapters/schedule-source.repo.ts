// CR-127 · E6 · spec §5.5/§5.9 · nguồn dữ liệu của sự kiện THEO LỊCH gói Hợp đồng (`ScheduledSource`, vòng `schedule-sweep` của engine):
// - `contract.expiring`: HĐ `done`, chưa thay thế, chưa có kết cục hiệu lực (gia hạn/chấm dứt), còn 0..N ngày tới `end_date`; dueKey = end_date.
// - `milestone.due`: mốc `open` của HĐ `done` chưa thay thế, còn 0..N ngày tới hạn; dueKey = due_date (dời hạn ⇒ khoá mới — #55).
// - `milestone.overdue`: mốc `open` trễ ≥ N ngày, chỉ bắt kịp tối đa `OVERDUE_CATCHUP_DAYS` ngày (bật quy trình không bắn cả lịch sử).
// MỖI trang MỘT câu văn bản hằng (Luật 4c), `tenant_id` tường minh, trang theo khoá `(ngày, id) > after` (chỉ mục `contracts_end_idx` / `obligations_open_idx`). Chạy trong tx role gói.
// Bỏ đối tượng đang có lượt mở (task Xác nhận mốc đang mở — #55) do engine lọc lúc phát (bảng hub, role gói không đọc).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export const EV_EXPIRING = "contract.expiring";
export const EV_MILESTONE_DUE = "milestone.due";
export const EV_MILESTONE_OVERDUE = "milestone.overdue";
export const SCHEDULE_EVENTS = [EV_EXPIRING, EV_MILESTONE_DUE, EV_MILESTONE_OVERDUE] as const;
export const MILESTONE_EVENTS = [EV_MILESTONE_DUE, EV_MILESTONE_OVERDUE] as const;
/** Mốc trễ quá N + 30 ngày không còn bắn khi quy trình mới bật (quyết định E6, spec §12). */
export const OVERDUE_CATCHUP_DAYS = 30;

export type DueRow = {
  ref: string;
  due_key: string;
  actor: string | null;
  owner: string | null;
  facts: Record<string, unknown> | string;
};
export type DueWindow = {
  today: string;
  days: number;
  limit: number;
  after: { dueKey: string; ref: string } | null;
};

const CONTRACT_FACTS = sql`jsonb_strip_nulls(jsonb_build_object(
    'total_value', case when jsonb_typeof(c.fields -> 'total_value' -> 'value') = 'number'
      then c.fields -> 'total_value' -> 'value' end,
    'deal', c.deal))`;

const MILESTONE_FACTS = sql`jsonb_strip_nulls(jsonb_build_object(
    'owner', c.owner_user_id::text,
    'kind', case when o.kind = 'payment' then 'payment'
      when o.kind = 'delivery' then case when o.direction = 'receive' then 'receive' else 'delivery' end
      else 'other' end))`;

const afterKey = (w: DueWindow) => w.after?.dueKey ?? "0001-01-01";
const afterRef = (w: DueWindow) => w.after?.ref ?? "00000000-0000-0000-0000-000000000000";

function expiringSql(t: string, w: DueWindow) {
  return sql`select c.id::text as ref, c.end_date::text as due_key,
      coalesce(c.owner_user_id, c.created_by)::text as actor, c.owner_user_id::text as owner, ${CONTRACT_FACTS} as facts
    from contracts.contracts c
    where c.tenant_id = ${t}::uuid and c.status = 'done' and c.superseded_at is null and c.kind = 'contract'
      and c.effect_outcome is null
      and c.end_date between ${w.today}::date and ${w.today}::date + ${w.days}::int
      and (c.end_date, c.id) > (${afterKey(w)}::date, ${afterRef(w)}::uuid)
    order by c.end_date, c.id limit ${w.limit}::int`;
}

function milestoneSql(t: string, w: DueWindow, overdue: boolean) {
  const from = overdue
    ? sql`${w.today}::date - (${w.days}::int + ${OVERDUE_CATCHUP_DAYS}::int)`
    : sql`${w.today}::date`;
  const to = overdue
    ? sql`${w.today}::date - ${w.days}::int`
    : sql`${w.today}::date + ${w.days}::int`;
  const extra = overdue
    ? sql`|| jsonb_build_object('days_late', ${w.today}::date - o.due_date)`
    : sql``;
  return sql`select o.id::text as ref, o.due_date::text as due_key,
      coalesce(c.owner_user_id, c.created_by)::text as actor, c.owner_user_id::text as owner,
      ${MILESTONE_FACTS} ${extra} as facts
    from contracts.obligations o
    join contracts.contracts c on c.id = o.contract_id and c.tenant_id = o.tenant_id
    where o.tenant_id = ${t}::uuid and o.status = 'open' and o.due_date between ${from} and ${to}
      and c.status = 'done' and c.superseded_at is null
      and (o.due_date, o.id) > (${afterKey(w)}::date, ${afterRef(w)}::uuid)
    order by o.due_date, o.id limit ${w.limit}::int`;
}

/** Bản ghi tới mốc của MỘT trang (một câu). Sự kiện lạ ⇒ []. */
export async function dueRows(tx: Tx, t: string, event: string, w: DueWindow): Promise<DueRow[]> {
  if (event === EV_EXPIRING) return tx.execute<DueRow>(expiringSql(t, w));
  if (event === EV_MILESTONE_DUE) return tx.execute<DueRow>(milestoneSql(t, w, false));
  if (event === EV_MILESTONE_OVERDUE) return tx.execute<DueRow>(milestoneSql(t, w, true));
  return [];
}

/** Dữ kiện HIỆN TẠI cho node Nếu (một câu). `days` (= N của quy trình) chỉ có ở dữ kiện lúc sự kiện; `days_late` theo `today`. */
export async function currentScheduleFacts(
  tx: Tx,
  t: string,
  event: string,
  ref: string,
  today: string,
): Promise<{ facts: Record<string, unknown>; owner: string | null } | null> {
  const q =
    event === EV_EXPIRING
      ? sql`select ${CONTRACT_FACTS} as facts, c.owner_user_id::text as owner
          from contracts.contracts c where c.id = ${ref}::uuid and c.tenant_id = ${t}::uuid`
      : sql`select ${MILESTONE_FACTS} || jsonb_build_object('days_late', greatest(${today}::date - o.due_date, 0)) as facts,
            c.owner_user_id::text as owner
          from contracts.obligations o
          join contracts.contracts c on c.id = o.contract_id and c.tenant_id = o.tenant_id
          where o.id = ${ref}::uuid and o.tenant_id = ${t}::uuid`;
  const [r] = await tx.execute<{ facts: Record<string, unknown> | string; owner: string | null }>(
    q,
  );
  if (!r) return null;
  const facts = typeof r.facts === "string" ? JSON.parse(r.facts) : r.facts;
  return { facts: facts ?? {}, owner: r.owner };
}

// HD7 plan §2/§4: mảnh SQL dùng chung của sổ thanh toán — JSON một đợt / một sự kiện (bigint ⇒ số JSON chính xác ≤ 10¹⁵, ngày ⇒
// chuỗi `YYYY-MM-DD`), CTE ghi sổ đối tác + nhật ký HĐ. Văn bản cố định, dữ liệu qua tham số.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

type J<T> = { j: T };
export const one = async <T>(tx: Tx, q: SQL): Promise<T> =>
  ((await tx.execute<J<T>>(q))[0]?.j ?? null) as T;
export const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

/** Trạng thái HĐ ĐÃ xác nhận (= `appendix.repo.ts::PRICED_STATUSES`; bản sao để không vòng import, `confirmed.test.ts` kiểm khớp). */
export const CONFIRMED_STATUSES = [
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
] as const;
/**
 * UAT CR-095 B5: đợt của bí danh `o` thuộc HĐ đã xác nhận — HĐ chờ xác nhận (needs_review, kể cả vừa mở lại do sửa MST) chưa có việc
 * tiền, như mgmt-app (đợt chỉ sinh khi HĐ được xác nhận). Semi-join theo PK HĐ; không thêm câu SQL.
 */
export const confirmedOf = (o: string) =>
  sql.raw(`exists (select 1 from contracts.contracts ck where ck.tenant_id = ${o}.tenant_id
    and ck.id = ${o}.contract_id and ck.status in (${CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", ")}))`);

/** JSON một đợt từ bí danh `o` (cột của `contracts.obligations`). */
export const obJson = (o: string) =>
  sql.raw(`jsonb_build_object('id', ${o}.id, 'contract_id', ${o}.contract_id, 'party', ${o}.party_key,
    'direction', ${o}.direction, 'kind', ${o}.kind, 'seq', ${o}.seq, 'due_date', ${o}.due_date, 'amount', ${o}.amount,
    'status', ${o}.status, 'done_at', ${o}.done_at, 'postponed_to', ${o}.postponed_to, 'postpones', ${o}.postpones,
    'reminders', ${o}.reminders, 'source', ${o}.source, 'estimated', ${o}.estimated, 'basis', ${o}.basis)`);

/**
 * HD8 · M1D-FR-01 (mgmt `partner_events.py` + `test_a_member_neither_sees_nor_undoes…`): sự kiện gắn với HĐ người dùng không thấy
 * (policy `contracts_visible` của M1) ⇒ không liệt kê, không huỷ được. Sự kiện không gắn HĐ (ghi tay theo đối tác) ai cũng thấy.
 * Điểm uy tín vẫn tính trên cả sổ (như mgmt: "scores still come from the whole ledger").
 */
export const seenEvent = (e: string) =>
  sql.raw(`(${e}.contract_id is null or exists (select 1 from contracts.contracts sc
    where sc.tenant_id = ${e}.tenant_id and sc.id = ${e}.contract_id))`);

/** JSON một sự kiện từ `e` (sổ) + `v` (hàng huỷ, left join): khoá phụ trong `data` (to/was/due_date/…) trải phẳng như mgmt. */
export const evJson = (e: string, v: string) =>
  sql.raw(`(${e}.data || jsonb_build_object('id', ${e}.id::text, 'party', ${e}.party_key, 'role', ${e}.role,
    'type', ${e}.type, 'at', ${e}.at, 'by', ${e}.by_user, 'by_name', contracts.user_label(${e}.by_user),
    'source', ${e}.source, 'contract_id', ${e}.contract_id,
    'obligation_id', ${e}.obligation_id, 'days_late', ${e}.days_late, 'amount', ${e}.amount, 'note', ${e}.note,
    'voided', ${v}.event_id is not null, 'voided_by', ${v}.by_user, 'voided_at', ${v}.at))`);

/** Sự kiện của MỘT đợt vừa cập nhật ở CTE `u` — chỉ khi đợt có đối tác (mgmt `if ob.get("company_id")`, D7-17). */
export function eventCte(
  t: string,
  e: {
    role: string;
    type: string;
    at: string;
    by: string;
    late?: number | null;
    amount?: SQL;
    note?: string | null;
    data?: unknown;
  },
): SQL {
  return sql`e as (
      insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id,
        obligation_id, days_late, amount, note, data)
      select ${t}::uuid, u.party_key, ${e.role}, ${e.type}, ${e.at}::date, ${e.by}::uuid, 'action', u.contract_id, u.id,
        ${e.late ?? null}::int, ${e.amount ?? sql`null::bigint`}, ${e.note ?? null}::text, ${json(e.data ?? {})}
      from u where u.party_key is not null)`;
}

/** Nhật ký HĐ (audit, kể cả đợt không có đối tác): `contract_events` một dòng cho đợt ở `u`. */
export function auditCte(t: string, type: string, by: string, data: SQL): SQL {
  return sql`a as (
      insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${t}::uuid, u.contract_id, ${type}, ${by}::uuid, ${data} from u)`;
}

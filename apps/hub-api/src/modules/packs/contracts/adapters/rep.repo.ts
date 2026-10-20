// V2-E · CD-02..05 · DT-03/04 · HD-06 · §5.1j: câu GHI + đọc cấu hình / đánh giá / việc ghi tay / điểm chốt của uy tín v2 — mỗi hàm
// MỘT câu văn bản cố định, lọc `tenant_id` tường minh ngoài RLS. Câu chấm (gom theo tập) ở `rep.sql.ts`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { LockPoint, LockRow, StoredRep } from "../application/reputation.ports";
import type { RepGroup, RepRole } from "../domain/rep-config.rules";
import { CONFIRMED_STATUSES, json, one } from "./ledger-sql";
import { aggRows, type CellParam, cellIndex, detailRows, factRows, scoreRows } from "./rep.sql";

export type { LockPoint, LockRow, StoredRep };

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));
/** Đối tác là một bên của HĐ đã xác nhận người gọi thấy (RLS), đúng vai + nhóm của ô. */
const partyOfCell = (t: string, party: string, role: string, grp: string) => sql`exists (
  select 1 from contracts.contracts c
  where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.status in (${CONFIRMED})
    and c.rep_cell = ${cellIndex(grp as RepGroup, role as RepRole)}::smallint and c.partner_key = ${party}::text)`;

export function repRepo(tx: Tx, t: string) {
  return { ...scoreReads(tx, t), ...eventWrites(tx, t), ...lockOps(tx, t) };
}
export type RepRepo = ReturnType<typeof repRepo>;

function scoreReads(tx: Tx, t: string) {
  return {
    scoreRows: (today: string, cells: CellParam[], party: string | null = null) =>
      scoreRows(tx, t, { today, cells, party }),
    aggRows: (today: string, cells: CellParam[], party: string | null = null) =>
      aggRows(tx, t, { today, cells, party }),
    factRows: (today: string, cells: CellParam[], party: string | null = null) =>
      factRows(tx, t, { today, cells, party }),
    detailRows: (today: string, cells: CellParam[], party: string) =>
      detailRows(tx, t, { today, cells, party }),

    /** Mọi hàng cấu hình đã lưu (ô / settings / job_types). */
    configs: () =>
      one<StoredRep[]>(
        tx,
        sql`select coalesce(json_agg(json_build_object('scope', s.scope, 'version', s.version, 'config', s.config,
            'updated_by', contracts.user_label(s.updated_by), 'updated_at', s.updated_at) order by s.scope), '[]'::json) as j
          from contracts.score_configs_v2 s where s.tenant_id = ${t}::uuid`,
      ),

    /** Lưu một phạm vi cấu hình (version + 1). MỘT câu. */
    saveConfig: (scope: string, config: unknown) =>
      one<StoredRep>(
        tx,
        sql`insert into contracts.score_configs_v2 as s (tenant_id, scope, version, config)
          values (${t}::uuid, ${scope}, 1, ${json(config)})
          on conflict (tenant_id, scope) do update set version = s.version + 1, config = excluded.config,
            updated_by = excluded.updated_by, updated_at = now()
          returning json_build_object('scope', s.scope, 'version', s.version, 'config', s.config,
            'updated_by', contracts.user_label(s.updated_by), 'updated_at', s.updated_at) as j`,
      ),
  };
}

function eventWrites(tx: Tx, t: string) {
  return {
    /** HD-06: một việc ghi tay; đối tác phải là bên của HĐ đã xác nhận người gọi thấy, đúng ô. Null ⇒ không thấy. */
    insertJob: (w: {
      party: string;
      role: RepRole;
      grp: RepGroup;
      job_type: string;
      at: string;
      note: string | null;
      contract_id: string | null;
    }) =>
      one<Record<string, unknown> | null>(
        tx,
        sql`with e as (
          insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id, note, grp,
            job_type)
          select ${t}::uuid, ${w.party}, ${w.role}, 'job', ${w.at}::date, nullif(current_setting('app.user_id', true), '')::uuid,
            'action', ${w.contract_id}::uuid, ${w.note}::text, ${w.grp}, ${w.job_type}
          where ${partyOfCell(t, w.party, w.role, w.grp)}
          returning *)
        select json_build_object('id', e.id::text, 'party', e.party_key, 'role', e.role, 'group', e.grp,
          'job_type', e.job_type, 'at', e.at, 'note', e.note, 'contract_id', e.contract_id,
          'by', contracts.user_label(e.by_user)) as j from e`,
      ),

    /** DT-04: một lượt chấm sao (chỉ thêm). Null ⇒ đối tác không thấy / không thuộc ô. */
    insertRating: (w: {
      party: string;
      role: RepRole;
      grp: RepGroup;
      criterion: string;
      stars: number;
      reason: string | null;
    }) =>
      one<Record<string, unknown> | null>(
        tx,
        sql`with r as (
          insert into contracts.score_ratings (tenant_id, party_key, role, grp, criterion, stars, reason)
          select ${t}::uuid, ${w.party}, ${w.role}, ${w.grp}, ${w.criterion}, ${w.stars}::smallint, ${w.reason}::text
          where ${partyOfCell(t, w.party, w.role, w.grp)}
          returning *)
        select json_build_object('id', r.id::text, 'party', r.party_key, 'role', r.role, 'group', r.grp,
          'criterion', r.criterion, 'stars', r.stars, 'reason', r.reason, 'by', contracts.user_label(r.by_user),
          'at', r.at) as j from r`,
      ),
  };
}

function lockOps(tx: Tx, t: string) {
  return {
    /** Mọi lượt chấm của một đối tác × vai (mới nhất trước, ≤ 200) — UI lấy lượt mới nhất mỗi người. */
    ratings: (party: string, role: RepRole) =>
      one<Record<string, unknown>[]>(
        tx,
        sql`select coalesce(json_agg(json_build_object('id', r.id::text, 'group', r.grp, 'criterion', r.criterion,
            'stars', r.stars, 'reason', r.reason, 'by_user', r.by_user, 'by', contracts.user_label(r.by_user), 'at', r.at)
            order by r.at desc, r.id desc), '[]'::json) as j
          from (select * from contracts.score_ratings r where r.tenant_id = ${t}::uuid and r.party_key = ${party}::text
            and r.role = ${role}::text order by r.at desc, r.id desc limit 200) r`,
      ),

    /** DT-03: điểm đã chốt của một đối tác × vai từ kỳ `from` (YYYY-MM-01). */
    lockHistory: (party: string, role: RepRole, from: string) =>
      one<LockPoint[]>(
        tx,
        sql`select coalesce(json_agg(json_build_object('period', to_char(l.period, 'YYYY-MM'), 'grp', l.grp,
            'score', l.score, 'level', l.level, 'jobs', l.jobs) order by l.period, l.grp), '[]'::json) as j
          from contracts.score_locks l where l.tenant_id = ${t}::uuid and l.party_key = ${party}::text
            and l.role = ${role}::text and l.period >= ${from}::date`,
      ),

    /** Kỳ đã chốt (có lượt chạy) từ `from`. */
    lockedPeriods: (from: string) =>
      one<string[]>(
        tx,
        sql`select coalesce(json_agg(to_char(r.period, 'YYYY-MM-DD') order by r.period), '[]'::json) as j
          from contracts.score_lock_runs r where r.tenant_id = ${t}::uuid and r.period >= ${from}::date`,
      ),

    /** §5.1j: chốt một kỳ — mọi hàng điểm + một dòng lượt chạy, MỘT câu; kỳ đã có ⇒ không đổi gì (chỉ thêm). */
    insertLocks: (period: string, rows: LockRow[]) =>
      one<number>(
        tx,
        sql`with run as (
          insert into contracts.score_lock_runs (tenant_id, period, rows) values (${t}::uuid, ${period}::date, ${rows.length}::int)
          on conflict (tenant_id, period) do nothing returning period),
        ins as (
          insert into contracts.score_locks (tenant_id, period, party_key, role, grp, score, data_score, level, jobs, detail)
          select ${t}::uuid, run.period, x.party, x.role, x.grp, x.score, x.data_score, x.level, x.jobs, x.detail
          from run, jsonb_to_recordset(${json(rows)}) as x (party text, role text, grp text, score smallint,
            data_score smallint, level text, jobs int, detail jsonb)
          on conflict do nothing returning 1)
        select (select count(*) from ins)::int as j`,
      ),
  };
}

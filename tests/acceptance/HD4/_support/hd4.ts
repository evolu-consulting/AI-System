// HD4-FR-01…07 · HD4-NFR-01…03 · hạ tầng int HD4: DB sạch X2a (clone mẫu) + vòng nhắc THẬT của hub-api (pool `hub_api`, role
// `contracts_job` tìm tenant, `contracts_rw` xử lý lô) + đồng hồ giả (FakeClock, không sleep). Dữ liệu dựng bằng owner (bỏ RLS)
// qua helper HD1. Điều kiện tiền đề (`needHd4`) đỏ NGAY với lý do rõ. Không chứa `it(...)`.
import { expect } from "bun:test";
import { FakeClock } from "@ai/test-kit/clock";
import type { Cap } from "@ai/test-kit/perf";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import {
  type ContractReminders,
  createContractReminders,
} from "../../../../apps/hub-api/src/modules/packs/contracts/reminders.mount";
import { HUB_API_URL } from "../../H1/_fixtures";
import { insContract, needContracts, P, type Sql, T, truncateAll } from "../../HD1/_support/hd1";

export type { Sql };
export { FakeClock, P, T };

export const VN = "Asia/Ho_Chi_Minh";
export const JOB_ROLE = "contracts_job";

/** Migration HD4 đã áp: bảng lịch `contract_schedule`, trigger lịch, role `contracts_job`. */
export async function needHd4(sql: Sql): Promise<void> {
  await needContracts(sql);
  const [r] = await sql<{ col: boolean; trg: boolean; role: boolean }[]>`select
    to_regclass('contracts.contract_schedule') is not null as col,
    exists (select 1 from pg_trigger where tgrelid = 'contracts.contracts'::regclass and tgname = 'contracts_hd4_schedule') as trg,
    exists (select 1 from pg_roles where rolname = ${JOB_ROLE}) as role`;
  expect({ hd4_migration: r }).toEqual({ hd4_migration: { col: true, trg: true, role: true } });
}

export async function resetHd4(sql: Sql): Promise<void> {
  await truncateAll(sql);
  await sql`truncate hub.notification_deliveries, hub.notifications`;
}

let seq = 0;
/** id HĐ HD4 duy nhất trong tiến trình test. */
export const hid = (): string => `4d400000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export type H4Row = {
  id?: string;
  tenant?: string;
  end?: string | null;
  notice?: number | string | null;
  status?: string;
  owner?: string | null;
  kind?: "contract" | "appendix";
  parent?: string | null;
  number?: string;
  handled?: unknown;
};
const fv = (value: unknown) => ({ value, quote: "", verified: false, edited: false });

/** Chèn HĐ (owner) với `end_date`/`notice_days`; trigger HD4 tự tính hạn + lịch. Trả id. */
export async function addContract(sql: Sql, r: H4Row = {}): Promise<string> {
  const id = r.id ?? hid();
  await insContract(sql, {
    id,
    tenant: r.tenant ?? T.acme,
    status: r.status ?? "active",
    owner: r.owner === undefined ? P.lan.id : r.owner,
    kind: r.kind ?? "contract",
    parent: r.parent ?? null,
    handled: r.handled,
    fields: {
      number: fv(r.number ?? `HĐ-${id.slice(-4)}`),
      supplier_name: fv("Công ty A"),
      buyer_name: fv("Công ty B"),
      end_date: fv(r.end === undefined ? "2026-12-31" : r.end),
      notice_days: fv(r.notice === undefined ? 30 : r.notice),
      total_value: fv(1_500_000_000),
      auto_renew: fv(false),
    },
  });
  return id;
}

export type HRow = {
  status: string;
  action_deadline: string | null;
  remind_at: Date | null;
  /** `contract_schedule.remind_at::text` (`-infinity` = xử lý ngay; null = không có lịch). */
  due: string | null;
  handled: { outcome: string } | null;
  version: number;
};
export async function rowOf(sql: Sql, id: string): Promise<HRow> {
  const [r] = await sql<
    HRow[]
  >`select c.status, to_char(c.action_deadline, 'YYYY-MM-DD') as action_deadline, s.remind_at,
    s.remind_at::text as due, c.handled, c.version
    from contracts.contracts c left join contracts.contract_schedule s on s.contract_id = c.id where c.id = ${id}`;
  return r as HRow;
}

export type Note = {
  tenant_id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
  dedup_key: string;
  kind: string;
};
export async function notes(sql: Sql): Promise<Note[]> {
  return sql<
    Note[]
  >`select tenant_id, user_id, title, body, link, dedup_key, kind from hub.notifications
    where source = 'contracts' order by seq`;
}
export async function reminderRows(sql: Sql) {
  return sql<{ contract_id: string; deadline: string; milestone: number; user_id: string }[]>`
    select contract_id, to_char(deadline, 'YYYY-MM-DD') as deadline, milestone, user_id
    from contracts.contract_reminders order by id`;
}

export type Rem = {
  r: ContractReminders;
  clock: FakeClock;
  db: ReturnType<typeof connectDb>;
  /** Số câu SQL pool gửi trong `fn` (trừ BEGIN/COMMIT/type-discovery) + văn bản/tham số để EXPLAIN. */
  count<R>(fn: () => Promise<R>): Promise<{ n: number; queries: string[]; caps: Cap[]; r: R }>;
  stop(): Promise<void>;
};
const TX_CTL = /^\s*((begin|commit|rollback)\b|select b\.oid, b\.typarray)/i;

/** Vòng nhắc thật trên pool `hub_api` riêng; múi tenant cố định `tz` (mặc định VN). */
export function startReminders(o: { at: string; tz?: string; batch?: number; pool?: number }): Rem {
  const db = connectDb(HUB_API_URL, o.pool ?? 4);
  const clock = new FakeClock(new Date(o.at));
  const r = createContractReminders(db, {
    timeZoneOf: async () => o.tz ?? VN,
    now: clock.now,
    ...(o.batch ? { batchSize: o.batch } : {}),
  });
  type Pool = { options: { debug?: (c: number, q: string, p: unknown[]) => void } };
  const pool = (db.db as unknown as { $client: Pool }).$client;
  return {
    r,
    clock,
    db,
    async count(fn) {
      const caps: Cap[] = [];
      const prev = pool.options.debug;
      pool.options.debug = (c, q, p) => {
        if (!TX_CTL.test(q)) caps.push({ text: q, params: p ?? [] });
        if (typeof prev === "function") prev(c, q, p);
      };
      try {
        const out = await fn();
        return { n: caps.length, queries: caps.map((x) => x.text), caps, r: out };
      } finally {
        pool.options.debug = prev;
      }
    },
    stop: () => db.close(),
  };
}

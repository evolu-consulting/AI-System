// CR-104 · ops-core · SQL của ops-watch (bảng nền tảng hub.ops_*, scope `system`). Luật 4c: số câu mỗi lượt cố định, không vòng
// lặp theo hàng — kết quả cả lượt đi qua MỘT tham số jsonb. Nhiều instance: (1) giành lượt bằng UPDATE có điều kiện trên dòng
// `ops_settings` (so `last_round_at` đã đọc) ⇒ chỉ một instance chạy mỗi lượt; (2) ghi kết quả dưới `pg_advisory_xact_lock` ⇒ trạng
// thái trước/sau so trong cùng khoá, sự kiện + chuông chỉ sinh MỘT lần mỗi lần đổi (kể cả khi "Kiểm tra ngay" chồng lượt nền).
import {
  OPS_CHECK_KEYS,
  OPS_EVENTS_KEEP,
  OPS_EVENTS_PAGE,
  type OpsCheckKey,
  type OpsCheckRow,
  type OpsEvent,
  type OpsSettings,
  type OpsStatus,
  opsSettingsFrom,
} from "@ai/contracts/hub-admin";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { OpsCheckOutcome } from "../application/ops.check";
import type { OpsNotifyItem, Transition } from "../domain/ops.rules";

const SYSTEM = { kind: "system" } as const;
/** Mốc thời gian làm tham số (driver không nhận `Date` trong `sql` thô). */
const tsz = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const LOCK = sql`select pg_advisory_xact_lock(hashtext('hub.ops_watch'))`;

export type OpsState = {
  settings: OpsSettings;
  updated_at: Date;
  updated_by: string | null;
  last_round_at: Date | null;
  last_manual_at: Date | null;
};

type StateRow = {
  settings: unknown;
  updated_at: Date | string | null;
  updated_by: string | null;
  last_round_at: Date | string | null;
  last_manual_at: Date | string | null;
};
const dateOrNull = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));
const iso = (v: Date | string): string => new Date(v).toISOString();

async function stateTx(tx: Tx, lock = false): Promise<OpsState> {
  const rows = await tx.execute<StateRow>(sql`
    select settings, updated_at, updated_by, last_round_at, last_manual_at
    from hub.ops_settings where id = 1 ${lock ? sql`for update` : sql``}`);
  const r = rows[0];
  return {
    settings: opsSettingsFrom(r?.settings),
    updated_at: new Date(r?.updated_at ?? 0),
    updated_by: r?.updated_by ?? null,
    last_round_at: dateOrNull(r?.last_round_at ?? null),
    last_manual_at: dateOrNull(r?.last_manual_at ?? null),
  };
}

type TransitionRow = {
  check_key: string;
  from_status: OpsStatus | null;
  to_status: OpsStatus;
  changed_at: Date | string;
  message: string;
  hint: string | null;
  known_from: OpsStatus | null;
  known_at: Date | string | null;
};

/**
 * Upsert trạng thái mới nhất + ghi `ops_events` CHỈ cho check đổi trạng thái (một câu). `prev` đọc ảnh chụp trước upsert của
 * cùng câu (dưới khoá advisory); `changed_at` giữ nguyên khi trạng thái không đổi. `last_known_*` = trạng thái khác `unknown`
 * gần nhất (chuông tính theo nó). Hàng đã có kết quả MỚI hơn lượt này (lượt chồng nhau) ⇒ không ghi đè, không sinh chuyển.
 */
async function upsertTx(tx: Tx, rs: readonly OpsCheckOutcome[], now: Date) {
  const rows = await tx.execute<TransitionRow>(sql`
    with inp as (
      select * from jsonb_to_recordset(${JSON.stringify(rs)}::jsonb)
        as x(check_key text, status text, value jsonb, message text, hint text)
    ), prev as (
      select c.check_key, c.status, c.last_known_status from hub.ops_checks c
      where c.check_key in (select check_key from inp)
    ), up as (
      insert into hub.ops_checks as c (check_key, status, value, message, hint, checked_at, changed_at,
        last_known_status, last_known_at)
      select i.check_key, i.status, i.value, coalesce(i.message, ''), i.hint, ${tsz(now)}, ${tsz(now)},
        nullif(i.status, 'unknown'), case when i.status = 'unknown' then null else ${tsz(now)} end
      from inp i
      on conflict (check_key) do update set status = excluded.status, value = excluded.value,
        message = excluded.message, hint = excluded.hint, checked_at = excluded.checked_at,
        changed_at = case when c.status = excluded.status then c.changed_at else excluded.changed_at end,
        last_known_status = case when excluded.status = 'unknown' then c.last_known_status else excluded.status end,
        last_known_at = case when excluded.status = 'unknown' or c.last_known_status = excluded.status
          then c.last_known_at else excluded.checked_at end
      where c.checked_at <= excluded.checked_at
      returning c.check_key, c.status, c.changed_at, c.message, c.hint, c.last_known_at
    ), tr as (
      select u.check_key, p.status as from_status, u.status as to_status, u.changed_at, u.message, u.hint,
        p.last_known_status as known_from, u.last_known_at as known_at
      from up u left join prev p on p.check_key = u.check_key
      where p.status is distinct from u.status
    ), ev as (
      insert into hub.ops_events (check_key, from_status, to_status, kind, detail, at)
      select tr.check_key, tr.from_status, tr.to_status, 'status', jsonb_build_object('message', tr.message), ${tsz(now)}
      from tr order by tr.check_key
    )
    select tr.* from tr order by tr.check_key`);
  return rows.map(
    (r): Transition => ({
      check_key: r.check_key,
      from_status: r.from_status,
      to_status: r.to_status,
      changed_at: new Date(r.changed_at),
      message: r.message,
      hint: r.hint,
      known_from: r.known_from,
      known_at: r.known_at === null ? null : new Date(r.known_at),
    }),
  );
}

type CheckRowDb = Omit<OpsCheckRow, "checked_at" | "changed_at"> & {
  checked_at: Date | string;
  changed_at: Date | string;
};
type EventRowDb = Omit<OpsEvent, "id" | "at"> & { id: string | number; at: Date | string };

export function opsRepo(db: Db) {
  return {
    state: (): Promise<OpsState> => withHubScope(db, SYSTEM, (tx) => stateTx(tx)),

    /**
     * Trạng thái + giá trị lượt trước của mọi check (một câu) — cho check cần so với lượt trước (host công khai). Kết quả kiểm
     * trước `staleBefore` (quá 2× tần suất: vòng dừng/check vừa bật lại) không đưa ⇒ không đếm "liền lỗi" từ dữ liệu cũ.
     */
    async previous(
      staleBefore: Date,
    ): Promise<Partial<Record<OpsCheckKey, { status: OpsStatus; value: unknown }>>> {
      const rows = await withHubScope(db, SYSTEM, (tx) =>
        tx.execute<{ check_key: OpsCheckKey; status: OpsStatus; value: unknown }>(
          sql`select check_key, status, value from hub.ops_checks where checked_at >= ${tsz(staleBefore)}`,
        ),
      );
      return Object.fromEntries(
        rows.map((r) => [r.check_key, { status: r.status, value: r.value }]),
      );
    },

    /** Giành lượt nền: thành công ⇔ `last_round_at` trong DB vẫn là giá trị đã đọc (instance khác chưa giành). */
    async claimRound(seen: Date | null, now: Date): Promise<boolean> {
      const rows = await withHubScope(db, SYSTEM, (tx) =>
        tx.execute<{ id: number }>(sql`
          insert into hub.ops_settings as s (id, last_round_at) values (1, ${tsz(now)})
          on conflict (id) do update set last_round_at = excluded.last_round_at
          where s.last_round_at is not distinct from ${seen ? tsz(seen) : null}
          returning s.id`),
      );
      return rows.length === 1;
    },

    /** "Kiểm tra ngay": giành khi lần bấm cuối cũ hơn `gapMs` (một câu, an toàn nhiều instance); đặt luôn mốc lượt. */
    async claimManual(now: Date, gapMs: number): Promise<boolean> {
      const cutoff = new Date(now.getTime() - gapMs);
      const rows = await withHubScope(db, SYSTEM, (tx) =>
        tx.execute<{ id: number }>(sql`
          insert into hub.ops_settings as s (id, last_round_at, last_manual_at) values (1, ${tsz(now)}, ${tsz(now)})
          on conflict (id) do update set last_round_at = excluded.last_round_at, last_manual_at = excluded.last_manual_at
          where s.last_manual_at is null or s.last_manual_at <= ${tsz(cutoff)}
          returning s.id`),
      );
      return rows.length === 1;
    },

    /**
     * Ghi một lượt trong MỘT tx, số câu cố định: khoá → upsert+sự kiện → chuông (nếu có) → giữ `OPS_EVENTS_KEEP` sự kiện mới nhất.
     * `toNotify` (luật thuần) chọn chuyển trạng thái nào báo chuông.
     */
    writeRound(
      rs: readonly OpsCheckOutcome[],
      now: Date,
      toNotify: (ts: readonly Transition[]) => OpsNotifyItem[],
    ): Promise<{ transitions: Transition[]; notified: number }> {
      return withHubScope(db, SYSTEM, async (tx) => {
        await tx.execute(LOCK);
        const transitions = rs.length === 0 ? [] : await upsertTx(tx, rs, now);
        const items = toNotify(transitions);
        let notified = 0;
        if (items.length > 0) {
          const [r] = await tx.execute<{ n: number }>(
            sql`select notify.enqueue_ops(${JSON.stringify(items)}::jsonb) as n`,
          );
          notified = Number(r?.n ?? 0);
        }
        await tx.execute(sql`
            delete from hub.ops_events where id <= (
              select id from hub.ops_events order by id desc offset ${OPS_EVENTS_KEEP} limit 1)`);
        return { transitions, notified };
      });
    },

    /** Màn hình: check mới nhất + 50 sự kiện gần nhất + cấu hình (một snapshot). */
    status(): Promise<{
      checks: OpsCheckRow[];
      events: OpsEvent[];
      state: OpsState;
    }> {
      return withHubScope(
        db,
        SYSTEM,
        async (tx) => {
          const checks = await tx.execute<CheckRowDb>(sql`
            select check_key, status, value, message, hint, checked_at, changed_at
            from hub.ops_checks order by check_key`);
          const events = await tx.execute<EventRowDb>(sql`
            select id, check_key, from_status, to_status, kind, actor_user_id, detail, at
            from hub.ops_events order by id desc limit ${OPS_EVENTS_PAGE}`);
          return {
            checks: checks.map((c) => ({
              ...c,
              checked_at: iso(c.checked_at),
              changed_at: iso(c.changed_at),
            })),
            events: events.map((e) => ({ ...e, id: Number(e.id), at: iso(e.at) })),
            state: await stateTx(tx),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    /** Lưu cấu hình + MỘT sự kiện `settings_changed` (ai, lúc nào, cũ → mới) trong cùng tx. */
    saveSettings(next: OpsSettings, actor: string, now: Date): Promise<OpsState> {
      return withHubScope(db, SYSTEM, async (tx) => {
        const old = await stateTx(tx, true);
        const json = JSON.stringify(next);
        await tx.execute(sql`
          with up as (
            insert into hub.ops_settings as s (id, settings, updated_by, updated_at) values (1, ${json}::jsonb, ${actor}, ${tsz(now)})
            on conflict (id) do update set settings = excluded.settings, updated_by = excluded.updated_by,
              updated_at = excluded.updated_at
            returning 1)
          insert into hub.ops_events (kind, actor_user_id, detail, at)
          select 'settings_changed', ${actor}, jsonb_build_object('old', ${JSON.stringify(old.settings)}::jsonb,
            'new', ${json}::jsonb), ${tsz(now)}
          from up`);
        const off = OPS_CHECK_KEYS.filter(
          (k) => old.settings.checks[k].enabled && !next.checks[k].enabled,
        );
        // Check vừa tắt: về trạng thái trung tính, quên trạng thái đã biết + giá trị ⇒ bật lại không báo "hồi phục" giả.
        if (off.length > 0)
          await tx.execute(sql`
            update hub.ops_checks set status = 'unknown', value = null, message = 'Đã tắt trong cấu hình', hint = null,
              checked_at = ${tsz(now)}, changed_at = ${tsz(now)}, last_known_status = null, last_known_at = null
            where check_key in (select jsonb_array_elements_text(${JSON.stringify(off)}::jsonb))`);
        return { ...old, settings: next, updated_by: actor, updated_at: now };
      });
    },
  };
}

export type OpsRepo = ReturnType<typeof opsRepo>;

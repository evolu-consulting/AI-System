// HUB-FR-75 · H2c-R27–R29 · PL2, PL11, PL13 · dọn file (plan §5.8, plan-db §4, plan-rules §4): **một** transaction `system`
// mỗi lượt giữ `pg_try_advisory_xact_lock(hashtext('hub.attach.sweep'))` (bận ⇒ `skipped`, 0 việc) → (a) R27 claim ≤ 500
// hàng chưa gắn quá 24 h (kể cả hàng đã đánh dấu dở) + đánh dấu `purged_at` → xoá nội dung → DELETE hàng đã xoá được →
// (b) R28 hội thoại đã xoá: claim + `purged_at = now` → xoá nội dung (hàng còn) → (c) mồ côi trên kho (lô `list` xoay vòng,
// con trỏ trong bộ nhớ theo storage): `.part`/file > 1 h không hàng sống ⇒ xoá; `.part` có hàng sống ⇒ `promote` (PL13).
// Đồng hồ tiêm (`now`) — không `now()` trong câu (AC-13). Xoá lỗi ⇒ `warn attachment-remove-failed`, lượt sau làm lại.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import { type Logger, logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import type { AttachmentStorage, StoredEntry } from "./storage";
import { orphanCandidate, SWEEP_BATCH, UNBOUND_TTL_MS } from "./sweeper.rules";

export type SweepDeps = { db: Db; storage: AttachmentStorage; now: Date; log?: Logger };
export type SweepResult = { expired: number; purged: number; orphans: number; skipped: boolean };

type Claimed = { id: string; storage_key: string };
type Ctx = { storage: AttachmentStorage; log: Logger; now: Date };

const SKIPPED: SweepResult = { expired: 0, purged: 0, orphans: 0, skipped: true };
/** Con trỏ quét kho (khoá cuối lô trước; null = từ đầu) — theo instance storage, chỉ trong bộ nhớ. */
const cursors = new WeakMap<AttachmentStorage, string | null>();

/** Mảng uuid → literal mảng Postgres (tham số hoá, ép `::uuid[]` ở câu). Id lấy từ DB hoặc tên đã qua `isUuidName`. */
const uuidArray = (ids: readonly string[]): string => `{${ids.join(",")}}`;
const idOf = (key: string): string => key.slice(key.indexOf("/") + 1);

/** Xoá nội dung; lỗi ⇒ warn (không ném) và false. */
async function tryRemove(c: Ctx, id: string, key: string): Promise<boolean> {
  try {
    await c.storage.remove(key);
    return true;
  } catch {
    c.log.warn("attachment-remove-failed", { attachment_id: id });
    return false;
  }
}

/** (a) R27 · plan-db §4.1: chưa gắn quá 24 h (hoặc đã đánh dấu dở) → xoá nội dung → DELETE hàng xoá được. */
async function sweepUnbound(tx: Tx, c: Ctx): Promise<number> {
  const now = c.now.toISOString();
  const cutoff = new Date(c.now.getTime() - UNBOUND_TTL_MS).toISOString();
  const rows = await tx.execute<Claimed>(sql`WITH c AS (
      SELECT id FROM hub.attachments
      WHERE message_id IS NULL AND (purged_at IS NOT NULL OR created_at < ${cutoff}::timestamptz)
      ORDER BY created_at LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
    )
    UPDATE hub.attachments a SET purged_at = coalesce(a.purged_at, ${now}::timestamptz) FROM c
    WHERE a.id = c.id RETURNING a.id, a.storage_key`);
  const removed: string[] = [];
  for (const r of rows) if (await tryRemove(c, r.id, r.storage_key)) removed.push(r.id);
  if (removed.length === 0) return 0;
  const del = await tx.execute<{ id: string }>(sql`DELETE FROM hub.attachments
    WHERE id = ANY(${uuidArray(removed)}::uuid[]) AND message_id IS NULL RETURNING id`);
  return del.length;
}

/** (b) R28 · plan-db §4.2: file của hội thoại đã xoá → `purged_at = now` → xoá nội dung (hàng giữ). */
async function sweepDeletedConversations(tx: Tx, c: Ctx): Promise<number> {
  const rows = await tx.execute<Claimed>(sql`WITH c AS (
      SELECT a.id FROM hub.conversations cv JOIN hub.attachments a ON a.conversation_id = cv.id
      WHERE cv.deleted_at IS NOT NULL AND a.purged_at IS NULL
      LIMIT ${SWEEP_BATCH} FOR UPDATE OF a SKIP LOCKED
    )
    UPDATE hub.attachments a SET purged_at = ${c.now.toISOString()}::timestamptz FROM c
    WHERE a.id = c.id RETURNING a.id, a.storage_key`);
  // Xoá lỗi ⇒ hàng đã purged (không còn "sống") ⇒ bước mồ côi dọn nội dung sau.
  for (const r of rows) await tryRemove(c, r.id, r.storage_key);
  return rows.length;
}

/** (c) R29 · plan-db §4.3: một lô `list` xoay vòng; khoá có hàng sống (`purged_at IS NULL`) theo PK. */
async function sweepOrphans(tx: Tx, c: Ctx): Promise<number> {
  const entries = await c.storage.list({
    after: cursors.get(c.storage) ?? null,
    limit: SWEEP_BATCH,
  });
  cursors.set(c.storage, entries.length < SWEEP_BATCH ? null : (entries.at(-1)?.key ?? null));
  if (entries.length === 0) return 0;
  const ids = [...new Set(entries.map((e) => idOf(e.key)))];
  const liveRows = await tx.execute<{ storage_key: string }>(sql`SELECT storage_key
    FROM hub.attachments WHERE id = ANY(${uuidArray(ids)}::uuid[]) AND purged_at IS NULL`);
  const live = new Set(liveRows.map((r) => r.storage_key));
  const nowMs = c.now.getTime();
  let n = 0;
  for (const e of entries) if (orphanCandidate(e, nowMs, live) && (await settle(c, e, live))) n++;
  return n;
}

/** `.part` của hàng sống ⇒ hoàn tất rename (PL13); khác ⇒ xoá. */
async function settle(c: Ctx, e: StoredEntry, live: ReadonlySet<string>): Promise<boolean> {
  if (!(e.partial && live.has(e.key))) return tryRemove(c, idOf(e.key), e.key);
  try {
    await c.storage.promote(e.key);
    return true;
  } catch {
    c.log.warn("attachment-remove-failed", { attachment_id: idOf(e.key) });
    return false;
  }
}

/** Một lượt: khoá thử toàn cục (bận ⇒ `skipped`) → đánh dấu `purged_at` → xoá nội dung → xoá hàng → mồ côi. */
export async function sweepOnce(d: SweepDeps): Promise<SweepResult> {
  const t0 = performance.now();
  const c: Ctx = { storage: d.storage, log: d.log ?? logger, now: d.now };
  const r = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('hub.attach.sweep')) AS ok`,
    );
    if (!lock?.ok) return SKIPPED;
    const expired = await sweepUnbound(tx, c);
    const purged = await sweepDeletedConversations(tx, c);
    const orphans = await sweepOrphans(tx, c);
    return { expired, purged, orphans, skipped: false };
  });
  if (r.expired + r.purged + r.orphans > 0)
    c.log.info("attachment-sweep", {
      expired: r.expired,
      purged: r.purged,
      orphans: r.orphans,
      ms: Math.round(performance.now() - t0),
    });
  return r;
}

/** Vòng nền (`lib/loop.ts`) gọi `sweepOnce` với `new Date()` mỗi `everyMs`. */
export function startAttachmentSweeper(
  d: Omit<SweepDeps, "now"> & { log: Logger; everyMs: number; signal?: AbortSignal },
): void {
  startLoop({
    name: "attachment-sweep",
    everyMs: d.everyMs,
    tick: () => sweepOnce({ db: d.db, storage: d.storage, now: new Date(), log: d.log }),
    log: d.log,
    signal: d.signal,
  });
}

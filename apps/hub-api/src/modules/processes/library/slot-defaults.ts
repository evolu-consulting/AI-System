// CR-120 §3 · cr120-single-source · ADR-0036 §3 · cấp phát mặc định khe (KHÔNG ở migration): tenant bật gói của khe (entitlement
// `<gói>-read` chưa thu hồi, feature không `off`, tenant active) mà tenant × khe CHƯA có luật nào ⇒ gán mẫu khe
// (`process_slots.default_def_id`, def chưa xoá + đã xuất bản) vào tập + đầu luật + luật `is_default` priority 49. Tenant × khe đã có
// luật (tenant admin đặt, kể cả không có mặc định) giữ nguyên — không đè lựa chọn của tenant. MỘT câu theo tập cho mọi khe (khe +
// tenant qua tham số JSON), idempotent (điều kiện "chưa có luật" + ON CONFLICT DO NOTHING ⇒ nhiều instance chạy cùng lúc vô hại).
// Def hiệu lực không đổi: trước khi cấp, `RESOLVE_SLOT_SQL` đã rơi về đúng mẫu khe. Chạy lúc boot + mỗi lần ảnh cấu hình đổi.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { slotFeatureKey } from "../../packs/kit/public";

export type DefaultSlot = { slot: string; feature: string };

/** Câu cấp phát (xuất cho test đếm/perf). `tenantIds` null ⇒ mọi tenant. Trả số luật mặc định vừa tạo. */
export const ENSURE_SLOT_DEFAULTS_SQL = (
  slots: readonly DefaultSlot[],
  tenantIds: readonly string[] | null,
) => sql`
  with s as (
    select e->>'slot' as slot, e->>'feature' as feature from jsonb_array_elements(${JSON.stringify(slots)}::jsonb) e),
  t as (
    select distinct en.tenant_id, s.slot, ps.default_def_id as def_id
    from s
    join admin.features f on f.key = s.feature and f.status <> 'off'
    join admin.feature_entitlements en on en.feature_id = f.id and en.revoked_at is null
    join admin.tenants tn on tn.id = en.tenant_id and tn.active
    join hub.process_slots ps on ps.slot = s.slot
    join hub.process_defs d on d.id = ps.default_def_id and d.deleted_at is null and d.slot = s.slot
      and d.published_version is not null
    where (${tenantIds === null} or en.tenant_id in
        (select x::uuid from jsonb_array_elements_text(${JSON.stringify(tenantIds ?? [])}::jsonb) x))
      and not exists (select 1 from hub.process_routing_rules r where r.tenant_id = en.tenant_id and r.slot = s.slot)),
  a as (
    insert into hub.process_tenant_defs (tenant_id, def_id, slot) select tenant_id, def_id, slot from t
    on conflict do nothing),
  h as (
    insert into hub.process_routings (tenant_id, slot) select tenant_id, slot from t on conflict do nothing),
  r as (
    insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default, source)
    select tenant_id, slot, 49, '{}'::jsonb, def_id, true, 'auto' from t on conflict do nothing returning 1)
  select count(*)::int as n from r`;

/** Khe cần cấp: đã đăng ký (gói đã mount), bỏ `dlc.*` (Rowan — không đụng) và khe opt-in (chỉ bật khi platform admin gán). */
export const defaultSlotsOf = (
  list: () => readonly { key: string; packKey: string; optIn?: boolean | undefined }[],
): DefaultSlot[] =>
  list()
    .filter((s) => !s.key.startsWith("dlc.") && !s.optIn)
    .map((s) => ({ slot: s.key, feature: slotFeatureKey(s.packKey) }));

/** Cấp phát một lượt (scope system). `tenantIds` vắng/null ⇒ mọi tenant. Trả số tenant × khe vừa được cấp. */
export async function ensureSlotDefaults(
  db: Db,
  slots: readonly DefaultSlot[],
  tenantIds: readonly string[] | null = null,
): Promise<number> {
  if (slots.length === 0 || tenantIds?.length === 0) return 0;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ n: number }>(ENSURE_SLOT_DEFAULTS_SQL(slots, tenantIds)),
  );
  return Number(r?.n ?? 0);
}

type ChangeSource = {
  onChange(fn: (c: { tenants: ReadonlySet<string> | null }) => void): () => void;
};

/**
 * Boot + mỗi lần ảnh cấu hình đổi (bật app = entitlement mới ⇒ NOTIFY `config_changed` kèm tenant). Không chạy chồng: lượt đang chạy
 * ⇒ gom tenant cho lượt kế (null = mọi tenant). Lỗi chỉ log (không chặn boot); trả promise lượt boot (test `await`).
 */
export function startSlotDefaults(d: {
  db: Db;
  config: ChangeSource;
  list: () => readonly { key: string; packKey: string; optIn?: boolean | undefined }[];
  log: Logger;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Set<string> | null | undefined; // undefined = không có lượt chờ
  const run = (tenants: readonly string[] | null): Promise<void> =>
    ensureSlotDefaults(d.db, defaultSlotsOf(d.list), tenants)
      .then((n) => {
        if (n > 0) d.log.info("slot-defaults-ensured", { count: n });
      })
      .catch((err) => d.log.error("slot-defaults-failed", safeErrorFields(err)));
  const kick = (tenants: ReadonlySet<string> | null): void => {
    if (d.signal?.aborted) return;
    if (running) {
      queued =
        tenants === null || queued === null ? null : new Set([...(queued ?? []), ...tenants]);
      return;
    }
    running = run(tenants ? [...tenants] : null).finally(() => {
      running = null;
      const next = queued;
      queued = undefined;
      if (next !== undefined) kick(next);
    });
  };
  const off = d.config.onChange((c) => kick(c.tenants));
  d.signal?.addEventListener("abort", off, { once: true });
  kick(null);
  return running ?? Promise.resolve();
}

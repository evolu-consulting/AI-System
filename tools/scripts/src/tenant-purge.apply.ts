// tool-tenant-purge · transaction xoá (MỘT transaction cho cả database): khoá hàng tenant, tắt tạm trigger người dùng của các bảng
// bị xoá (append-only audit, guard read-only; DDL nằm trong transaction ⇒ lỗi = hoàn tác hết), đặt NULL FK vòng, xoá con trước cha,
// bật lại trigger, kiểm còn 0 hàng, bump config_version (+ profile_version, hub_config_version nếu có) + pg_notify (gửi lúc commit),
// ghi một hàng audit platform (tenant_id NULL).
import { CONFIG_CHANNEL, PROFILE_CHANNEL } from "@ai/contracts/config";
import { HUB_CONFIG_CHANNEL, HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import type postgres from "postgres";
import { countRows, type Sql } from "./tenant-purge.db";
import { anonymizePartner, type PartnerStats } from "./tenant-purge.partner";
import {
  type Counts,
  type Plan,
  PurgeRefused,
  q,
  qRel,
  type Rel,
  type TenantRow,
  whereAs,
} from "./tenant-purge.rules";

type Tx = postgres.TransactionSql;
const all = async <T>(sql: Sql, text: string, p: unknown[] = []): Promise<T[]> =>
  (await sql.unsafe(text, p as never[])) as unknown as T[];

type Trig = { rel: Rel; name: string };

/** Trigger người dùng (không phải FK nội bộ) đang bật, chạy khi DELETE (hoặc UPDATE với bảng phải đặt NULL trước). */
async function userTriggers(tx: Tx, plan: Plan): Promise<Trig[]> {
  const upd = [...new Set(plan.preNull.map((f) => f.child))];
  return all<Trig>(
    tx,
    `select n.nspname || '.' || c.relname as rel, t.tgname as name
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and t.tgenabled <> 'D'
       and ((n.nspname || '.' || c.relname = any($1::text[]) and (t.tgtype & 8) <> 0)
         or (n.nspname || '.' || c.relname = any($2::text[]) and (t.tgtype & 16) <> 0))
     order by 1, 2`,
    [plan.order, upd],
  );
}

async function setTriggers(tx: Tx, trigs: readonly Trig[], on: boolean): Promise<void> {
  for (const t of trigs)
    await tx.unsafe(`alter table ${qRel(t.rel)} ${on ? "enable" : "disable"} trigger ${q(t.name)}`);
}

/** Xoá theo thứ tự; trả số hàng đã xoá mỗi bảng. */
async function deleteAll(tx: Tx, plan: Plan, tenantId: string): Promise<Counts> {
  if (plan.deferred.length) {
    const names = plan.deferred.map((f) => `${q(f.child.split(".")[0] as string)}.${q(f.name)}`);
    await tx.unsafe(`set constraints ${names.join(", ")} deferred`);
  }
  for (const f of plan.preNull) {
    const set = f.cols.filter((c) => c !== "tenant_id").map((c) => `${q(c)} = null`);
    if (set.length === 0)
      throw new PurgeRefused(`FK vòng ${f.name} chỉ gồm tenant_id — không đặt NULL được`);
    await tx.unsafe(
      `update ${qRel(f.child)} t set ${set.join(", ")} where ${whereAs(plan.where[f.child] as string, "t")}`,
      [tenantId],
    );
  }
  const out: Counts = {};
  for (const r of plan.order) {
    const res = await tx.unsafe(
      `delete from ${qRel(r)} t where ${whereAs(plan.where[r] as string, "t")}`,
      [tenantId],
    );
    out[r] = res.count;
  }
  return out;
}

async function exists(tx: Tx, rel: string, col?: string): Promise<boolean> {
  const [r] = await all<{ ok: boolean }>(
    tx,
    col
      ? `select exists (select 1 from information_schema.columns where table_schema || '.' || table_name = $1 and column_name = $2) as ok`
      : "select to_regclass($1) is not null as ok",
    col ? [rel, col] : [rel],
  );
  return r?.ok === true;
}

export type Versions = { config: number; profile: number | null; hub: number | null };

/** Bump phiên bản cấu hình + NOTIFY (pg_notify trong transaction ⇒ chỉ gửi khi commit) để mọi cache bỏ tenant. */
async function bumpAndNotify(tx: Tx, tenantId: string): Promise<Versions> {
  const [c] = await all<{ v: number }>(
    tx,
    `insert into admin.config_meta (id, config_version, updated_at) values (1, 1, now())
     on conflict (id) do update set config_version = admin.config_meta.config_version + 1, updated_at = now()
     returning config_version as v`,
  );
  const config = c?.v as number;
  const payload = JSON.stringify({ v: config, entity: "tenant", tenant_id: tenantId });
  await tx.unsafe("select pg_notify($1, $2)", [CONFIG_CHANNEL, payload]);
  let profile: number | null = null;
  if (await exists(tx, "admin.config_meta", "profile_version")) {
    const [p] = await all<{ v: string | number }>(
      tx,
      "update admin.config_meta set profile_version = profile_version + 1 where id = 1 returning profile_version as v",
    );
    profile = p ? Number(p.v) : null; // bigint ⇒ chuỗi ở postgres.js
    if (profile !== null)
      await tx.unsafe("select pg_notify($1, $2)", [
        PROFILE_CHANNEL,
        JSON.stringify({ v: profile, entity: "tenant", tenant_id: tenantId }),
      ]);
  }
  let hub: number | null = null;
  if (await exists(tx, "hub.config_meta")) {
    const [h] = await all<{ v: number }>(
      tx,
      "update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1 returning hub_config_version as v",
    );
    hub = h?.v ?? null;
    if (hub !== null)
      await tx.unsafe("select pg_notify($1, $2)", [
        HUB_CONFIG_CHANNEL,
        JSON.stringify({ v: HUB_CONTRACT_VERSION, version: hub }),
      ]);
  }
  return { config, profile, hub };
}

export type AuditMeta = { actorId: string | null; operator: string; files: number };

/** Một hàng audit platform (tenant_id NULL — chỉ platform thấy): ai/khi nào/tenant nào/bao nhiêu hàng. */
async function auditPurge(
  tx: Tx,
  t: TenantRow,
  deleted: Counts,
  v: Versions,
  m: AuditMeta,
  partner: PartnerStats,
) {
  const tables = Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0));
  const total = Object.values(deleted).reduce((s, n) => s + n, 0);
  const summary = {
    purge: true,
    tenant: { id: t.id, key: t.key, name: t.name },
    operator: m.operator,
    rows_total: total,
    tables,
    filebox_files: m.files,
    partner,
  };
  await tx.unsafe(
    `insert into admin.audit_log (tenant_id, actor_id, actor_username, action, entity, entity_id, entity_name,
       config_version, before, after, summary, snapshot)
     values (null, $1::uuid, (select username from admin.users where id = $1::uuid), 'delete', 'tenant', $2::uuid, $3,
       $4::int, $5::text::jsonb, null, $6::text::jsonb, false)`, // ::text trước: postgres.js mã hoá chuỗi cho jsonb thành chuỗi JSON
    [
      m.actorId,
      t.id,
      t.name.slice(0, 200),
      v.config,
      JSON.stringify({ id: t.id, key: t.key, name: t.name }),
      JSON.stringify(summary),
    ],
  );
}

export type Applied = { deleted: Counts; versions: Versions; partner: PartnerStats };

/** Phần ghi của transaction (gọi bên trong `sql.begin`); lỗi ở bất kỳ bước nào ⇒ hoàn tác toàn bộ. */
export async function applyPurge(tx: Tx, plan: Plan, t: TenantRow, m: AuditMeta): Promise<Applied> {
  await tx.unsafe("select 1 from admin.tenants where id = $1::uuid for update", [t.id]);
  const trigs = await userTriggers(tx, plan);
  await setTriggers(tx, trigs, false);
  const partner = await anonymizePartner(tx, t.id); // trước khi xoá: cần id hộp thư để tìm bản sao phía bên kia
  const deleted = await deleteAll(tx, plan, t.id);
  await setTriggers(tx, trigs, true);
  const left = await countRows(tx, plan, t.id);
  const rest = Object.entries(left).filter(([, n]) => n > 0);
  if (rest.length)
    throw new PurgeRefused(
      `còn hàng sau khi xoá (hoàn tác): ${rest.map(([r, n]) => `${r}=${n}`).join(", ")}`,
    );
  const versions = await bumpAndNotify(tx, t.id);
  await auditPurge(tx, t, deleted, versions, m, partner);
  return { deleted, versions, partner };
}

// CR-105 · L2a · design §6: chuyển mẫu duyệt HĐ cũ sang thư viện quy trình — chạy MỘT lần ở bước deploy (sau hub 0069), idempotent.
// Tenant có `contracts.approval_flows` (hoặc `approval_settings`) mà mẫu (đổi id phòng ban ⇒ MÃ `admin.groups.key`) KHÁC def mặc
// định 0069 (bản v1 seed) ⇒ def thư viện "Quy trình HĐ – <tên tenant>" (key `hd-<admin.tenants.key>`), xuất bản v1, gán khe
// `contracts.approval`. Khác ⇒ không gán (chạy mặc định). Chạy lại: tenant đã có key def ⇒ bỏ qua. Id phòng ban không còn ⇒ bỏ tenant
// đó, báo. Không xoá `approval_flows` (để quay lui). Theo tập (Luật 4c): 4 câu đọc + 3 câu ghi trong MỘT tx, không phụ thuộc số tenant.
//   bun --env-file=../../.env.local scripts/process-library-backfill.ts [--dry-run]
// DSN: `BACKFILL_DATABASE_URL` ‖ `DATABASE_URL` của DB Hub (role chủ — đọc `contracts.*` của mọi tenant).
import { createHash } from "node:crypto";
import postgres from "postgres";
import { APPROVAL_DEFAULTS } from "../src/modules/packs/contracts/domain/approval-def.rules";
import type { FlowStep } from "../src/modules/packs/contracts/domain/approval-flow.types";
import {
  APPROVAL_SLOT,
  compileSlotStages,
  validateSlotBody,
} from "../src/modules/packs/contracts/domain/approval-slot.rules";
import {
  APPROVAL_DEFAULT_DEF,
  defaultSlotBody,
  keyedSlotBody,
} from "../src/modules/packs/contracts/domain/approval-slot-default.rules";

type Sql = postgres.Sql;
export type BackfillItem = { tenant: string; key: string };
export type BackfillReport = {
  dryRun: boolean;
  created: BackfillItem[];
  skipped: (BackfillItem & {
    reason: "exists" | "default" | "group-missing" | "invalid";
    detail?: unknown;
  })[];
};
type Cand = {
  id: string;
  key: string;
  name: string;
  steps: FlowStep[] | null;
  threshold: string | null;
  l1: string | null;
  l2: string | null;
};
type Plan = { tenantId: string; key: string; name: string; body: unknown; stages: unknown[] };

/** `hd-<mã tenant>` (≤ 32 ký tự của `process_defs_key_ck`); mã dài ⇒ cắt + 5 hex sha256 để không trùng. */
export function libKeyOf(tenantKey: string): string {
  const k = `hd-${tenantKey}`;
  if (k.length <= 32) return k;
  const h = createHash("sha256").update(tenantKey).digest("hex").slice(0, 5);
  return `hd-${tenantKey.slice(0, 23)}-${h}`;
}

/** So JSON bỏ thứ tự khoá. */
function canon(x: unknown): string {
  const walk = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, w]) => [k, walk(w)]),
          )
        : v;
  return JSON.stringify(walk(x));
}

function bodyOf(c: Cand, keyOf: (id: string) => string | undefined) {
  if (c.steps) return keyedSlotBody(c.steps, keyOf);
  const s = {
    threshold: Number(c.threshold ?? APPROVAL_DEFAULTS.threshold),
    level1GroupKey: c.l1 ?? APPROVAL_DEFAULTS.level1GroupKey,
    level2GroupKey: c.l2 ?? APPROVAL_DEFAULTS.level2GroupKey,
  };
  return { body: defaultSlotBody(s) };
}

async function plan(sql: Sql, rep: BackfillReport): Promise<Plan[]> {
  const [dflt] = await sql<{ slot_body: unknown }[]>`select slot_body from hub.process_def_releases
    where def_id = ${APPROVAL_DEFAULT_DEF.id} and rel_version = 1`;
  if (!dflt) throw new Error("thiếu def mặc định 0069 — chạy db:migrate trước");
  const cands = await sql<
    Cand[]
  >`select t.id::text as id, t.key, t.name, f.steps, s.threshold::text as threshold,
      s.level1_group_key as l1, s.level2_group_key as l2
    from admin.tenants t left join contracts.approval_flows f on f.tenant_id = t.id
      left join contracts.approval_settings s on s.tenant_id = t.id
    where f.tenant_id is not null or s.tenant_id is not null order by t.key`;
  const ids = cands.map((c) => c.id);
  const groups = await sql<
    { id: string; key: string }[]
  >`select id::text as id, key from admin.groups
    where tenant_id = any(${sql.array(ids)}::uuid[])`;
  const keyOfId = new Map(groups.map((g) => [g.id, g.key]));
  const keys = cands.map((c) => libKeyOf(c.key));
  const taken = new Set(
    (
      await sql<{ key: string }[]>`select key from hub.process_defs
    where tenant_id is null and deleted_at is null and key = any(${sql.array(keys)}::text[])`
    ).map((r) => r.key),
  );
  const out: Plan[] = [];
  for (const c of cands) {
    const item = { tenant: c.key, key: libKeyOf(c.key) };
    if (taken.has(item.key)) {
      rep.skipped.push({ ...item, reason: "exists" });
      continue;
    }
    const r = bodyOf(c, (id) => keyOfId.get(id));
    if ("missing" in r) {
      rep.skipped.push({ ...item, reason: "group-missing", detail: r.missing });
      continue;
    }
    if (canon(r.body) === canon(dflt.slot_body)) {
      rep.skipped.push({ ...item, reason: "default" });
      continue;
    }
    const issues = validateSlotBody(r.body);
    if (issues.length) {
      rep.skipped.push({ ...item, reason: "invalid", detail: issues });
      continue;
    }
    const name = `Quy trình HĐ – ${c.name}`.slice(0, 120);
    out.push({
      tenantId: c.id,
      key: item.key,
      name,
      body: r.body,
      stages: compileSlotStages(r.body),
    });
    rep.created.push(item);
  }
  return out;
}

/** Ghi theo tập (3 câu): def thư viện (xuất bản v1) ← mô tả/input của def mặc định, bản v1, gán (đã có gán ⇒ giữ). */
async function write(sql: Sql, rows: Plan[]): Promise<void> {
  const data = JSON.stringify(
    rows.map((p) => ({
      key: p.key,
      name: p.name,
      body: p.body,
      stages: p.stages,
      tid: p.tenantId,
    })),
  );
  await sql.begin(async (tx) => {
    await tx`insert into hub.process_defs (tenant_id, key, name, description, input_hint, run_group_ids, stages,
        token_budget, enabled, sources, inputs, slot, slot_body, published_version)
      select null, x.key, x.name, d.description, d.input_hint, '{}'::uuid[], x.stages, null, true, '[]'::jsonb, d.inputs,
        ${APPROVAL_SLOT}, x.body, 1
      from jsonb_to_recordset(${data}::text::jsonb) as x(key text, name text, body jsonb, stages jsonb, tid uuid)
        cross join (select description, input_hint, inputs from hub.process_defs where id = ${APPROVAL_DEFAULT_DEF.id}) d`;
    await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
      select d.id, 1, d.name, d.stages, d.slot_body, 'backfill CR-105'
      from hub.process_defs d join jsonb_to_recordset(${data}::text::jsonb) as x(key text) on x.key = d.key
      where d.tenant_id is null and d.deleted_at is null`;
    await tx`insert into hub.process_slot_assignments (tenant_id, slot, def_id)
      select x.tid, ${APPROVAL_SLOT}, d.id
      from jsonb_to_recordset(${data}::text::jsonb) as x(key text, tid uuid)
        join hub.process_defs d on d.key = x.key and d.tenant_id is null and d.deleted_at is null
      on conflict (tenant_id, slot) do nothing`;
  });
}

export async function backfill(sql: Sql, o: { dryRun: boolean }): Promise<BackfillReport> {
  const rep: BackfillReport = { dryRun: o.dryRun, created: [], skipped: [] };
  const rows = await plan(sql, rep);
  if (!o.dryRun && rows.length) await write(sql, rows);
  return rep;
}

if (import.meta.main) {
  const dsn = process.env.BACKFILL_DATABASE_URL || process.env.DATABASE_URL;
  if (!dsn) {
    console.error(
      "dùng: process-library-backfill.ts [--dry-run] (cần BACKFILL_DATABASE_URL/DATABASE_URL của DB Hub)",
    );
    process.exit(2);
  }
  const sql = postgres(dsn, { max: 1 });
  try {
    console.log(
      JSON.stringify(await backfill(sql, { dryRun: process.argv.includes("--dry-run") }), null, 2),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

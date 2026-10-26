// CR-097 D1 · backfill dữ liệu khách theo đợt K1/K2 — IDEMPOTENT (chạy lại = 0 hàng đổi), MỘT tx, theo tập (mỗi việc một câu UPDATE
// cho cả tenant, không vòng theo hàng), CHỈ một tenant (`--tenant`). `--dry-run` chạy thật trong tx rồi HUỶ (số hàng là số thật).
//   bun tools/scripts/src/d1-backfill.ts --tenant nitigroup [--dry-run]
// Việc: (1) `root_id` thiếu ⇒ = id (2) HĐ gốc `version_no`/`root_id` lệch ⇒ 1/id (3) HĐ đã xác nhận thiếu `locked_at` (K1).
// Nhãn "Chưa có văn bản" (HĐ nhập tay cũ, `file_id` null) là SUY KHI ĐỌC (`has_document`) ⇒ chỉ đếm. Sao đã nhập
// (`score_ratings`, `partner_events.rating`) KHÔNG bị chạm — script đo trước/sau và huỷ tx nếu lệch.
// Cần DATABASE_URL của chủ migration (siêu người dùng, như seed-demo-v2). Không migration; DB phải đã chạy 0048/0049.
import postgres from "postgres";
import {
  assertConverged,
  assertRatingsUntouched,
  type Changed,
  type Flags,
  type Measure,
  parseFlags,
  report,
} from "./d1-backfill.rules";

type Tx = postgres.TransactionSql;
class DryRun extends Error {}

const CONFIRMED = ["active", "expiring", "expired", "renewed", "terminated"];

async function measure(tx: Tx, t: string): Promise<Measure> {
  const [r] = await tx<Measure[]>`select
    (select count(*)::int from contracts.contracts where tenant_id = ${t} and root_id is null) as "rootMissing",
    (select count(*)::int from contracts.contracts where tenant_id = ${t} and supersedes_id is null
      and root_id is not null and (version_no <> 1 or root_id <> id)) as "versionBad",
    (select count(*)::int from contracts.contracts where tenant_id = ${t} and supersedes_id is null
      and locked_at is null and status = any(${CONFIRMED}::text[])) as "unlocked",
    (select count(*)::int from contracts.contracts where tenant_id = ${t} and kind = 'contract'
      and superseded_at is null and file_id is null) as "noDocument",
    (select count(*)::int from contracts.score_ratings where tenant_id = ${t}) as "scoreRatings",
    (select count(*)::int from contracts.partner_events where tenant_id = ${t} and type = 'rating') as "ratingEvents"`;
  return r as Measure;
}

/** Ba câu UPDATE theo tập. Điều kiện `where` loại hàng đã đúng ⇒ chạy lại không đổi gì. */
async function fix(tx: Tx, t: string): Promise<Changed> {
  const root = await tx`update contracts.contracts set root_id = id
    where tenant_id = ${t} and root_id is null`;
  const version = await tx`update contracts.contracts set version_no = 1, root_id = id
    where tenant_id = ${t} and supersedes_id is null and root_id is not null and (version_no <> 1 or root_id <> id)`;
  // Chỉ HĐ gốc: bản v≥2 chưa khoá mà đã xác nhận sẽ kích cutover (K2) — không để backfill gây tác dụng phụ ấy.
  const locked =
    await tx`update contracts.contracts set locked_at = coalesce(confirmed_at, updated_at, now()),
      locked_by = confirmed_by
    where tenant_id = ${t} and supersedes_id is null and locked_at is null and status = any(${CONFIRMED}::text[])`;
  return { root: root.count, version: version.count, locked: locked.count };
}

export async function backfill(
  sql: postgres.Sql,
  tenantId: string,
  tenantKey: string,
  dryRun: boolean,
): Promise<{ changed: Changed; after: Measure; lines: string[] }> {
  let out: { changed: Changed; after: Measure; lines: string[] } | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const before = await measure(tx, tenantId);
      const changed = await fix(tx, tenantId);
      const after = await measure(tx, tenantId);
      assertRatingsUntouched(before, after);
      assertConverged(after);
      out = { changed, after, lines: report(tenantKey, changed, after, dryRun) };
      if (dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  if (!out) throw new Error("d1-backfill: không có kết quả");
  return out;
}

async function resolve(sql: postgres.Sql, f: Flags): Promise<string> {
  const [t] = await sql<{ id: string }[]>`select id from admin.tenants where key = ${f.tenant}`;
  if (!t) throw new Error(`d1-backfill: không có tenant "${f.tenant}"`);
  return t.id;
}

async function main(argv: readonly string[]): Promise<void> {
  const flags = parseFlags(argv);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("d1-backfill: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql<
      { su: boolean }[]
    >`select rolsuper as su from pg_roles where rolname = current_user`;
    if (!r?.su) throw new Error("d1-backfill: cần vai siêu người dùng (chủ migration)");
    const id = await resolve(sql, flags);
    const res = await backfill(sql, id, flags.tenant, flags.dryRun);
    for (const l of res.lines) console.log(l);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });

// CR-122 · M1 · báo cáo bóng `bun run flow:shadow-diff [--days=N]`: với MỖI công ty, sự kiện flow đã xử lý khi cờ `FLOW_TRIGGERS` TẮT
// (bộ điều phối chỉ ghi `outcome {shadow, would_run}`) so với lượt mà ĐƯỜNG KHE CŨ thực sự mở cho cùng bản ghi (`process_runs` không có
// `flow_event_id`, cùng `pack_record_id = ref`, trong [-1 phút, +1 giờ] quanh sự kiện). So theo GỐC Thư viện của flow
// (`coalesce(source_template_id, id)`): bản công ty / def vật chất hoá của đường cũ cùng gốc ⇒ khớp. Tập rỗng cả hai phía ⇒ khớp.
// Chỉ ĐỌC. DSN: `BACKFILL_DATABASE_URL` ‖ `DATABASE_URL` (DB Hub, role chủ — đọc mọi công ty). Thoát mã 1 khi còn lệch.
//   bun --env-file=.env.local apps/hub-api/scripts/flow-shadow-diff.ts
import postgres from "postgres";

export type ShadowRow = { tenant: string; total: number; matched: number; mismatched: number };

/** Một câu theo tập (Luật 4c), tham số: số ngày nhìn lại. */
export async function shadowDiff(sql: postgres.Sql, days = 7): Promise<ShadowRow[]> {
  const rows = await sql<{ tenant: string; total: number; matched: number }[]>`
    with ev as (
      select e.id, e.tenant_id, e.ref, e.created_at, e.outcome
      from hub.flow_events e
      where e.processed_at is not null and e.outcome ->> 'shadow' = 'true'
        and e.created_at >= now() - make_interval(days => ${days}::int)),
    nw as (
      select ev.id, coalesce(array_agg(distinct coalesce(d.source_template_id, d.id)) filter (where d.id is not null), '{}') as roots
      from ev
      left join lateral jsonb_array_elements_text(coalesce(ev.outcome -> 'would_run', '[]'::jsonb)) as w (cf) on true
      left join hub.company_flows cf on cf.id = w.cf::uuid and cf.tenant_id = ev.tenant_id
      left join hub.process_defs d on d.id = cf.flow_id
      group by ev.id),
    old as (
      select ev.id, coalesce(array_agg(distinct coalesce(d.source_template_id, d.id)) filter (where d.id is not null), '{}') as roots
      from ev
      left join hub.process_runs r on r.tenant_id = ev.tenant_id and r.pack_record_id::text = ev.ref
        and r.flow_event_id is null and r.created_at >= ev.created_at - interval '1 minute'
        and r.created_at < ev.created_at + interval '1 hour'
      left join hub.process_defs d on d.id = r.process_def_id
      group by ev.id)
    select coalesce(nullif(tn.name, ''), tn.key, ev.tenant_id::text) as tenant, count(*)::int as total,
      (count(*) filter (where nw.roots <@ old.roots and old.roots <@ nw.roots))::int as matched
    from ev
    join nw on nw.id = ev.id join old on old.id = ev.id
    left join admin.tenants tn on tn.id = ev.tenant_id
    group by 1 order by 1`;
  return rows.map((r) => ({ ...r, mismatched: r.total - r.matched }));
}

export function formatShadow(rows: readonly ShadowRow[]): string {
  if (rows.length === 0)
    return "Chưa có sự kiện bóng nào (cờ FLOW_TRIGGERS tắt và app chưa phát sự kiện?)";
  const lines = rows.map((r) => `${r.tenant}: ${r.matched}/${r.total} khớp, ${r.mismatched} lệch`);
  const bad = rows.reduce((n, r) => n + r.mismatched, 0);
  return `${lines.join("\n")}\nTổng lệch: ${bad}`;
}

async function main(): Promise<void> {
  const url = process.env.BACKFILL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("thiếu BACKFILL_DATABASE_URL/DATABASE_URL");
  const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 7);
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await shadowDiff(sql, Number.isFinite(days) && days > 0 ? days : 7);
    console.log(formatShadow(rows));
    if (rows.some((r) => r.mismatched > 0)) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main) await main();

// CR-116 · bench hub (chỉ đo): in bảng xếp hạng pg_stat_statements sau một lượt `-Step perf` trên evotest.
// Dùng: `bun tests/acceptance/cr116-bench-hub/pgss-dump.ts <reset|dump> [url]`. Cần `shared_preload_libraries=pg_stat_statements`
// (chỉ bật tạm trong kit evotest khi đo; không phải cấu hình sản phẩm). Không có extension ⇒ in lý do rồi thoát 0.
import postgres from "postgres";

const [mode = "dump", url = "postgres://ai:ai_dev_pw@pg:5432/ai_system"] = process.argv.slice(2);
const sql = postgres(url, { max: 1, onnotice: () => {} });
type Row = Record<string, unknown>;
try {
  await sql`create extension if not exists pg_stat_statements`;
  if (mode === "reset") {
    await sql`select pg_stat_statements_reset()`;
    console.log("[pgss] reset");
  } else {
    const q = (order: string) =>
      sql.unsafe(`select d.datname, s.calls, round(s.total_exec_time::numeric, 1) as total_ms,
        round(s.mean_exec_time::numeric, 3) as mean_ms, s.rows, s.shared_blks_hit + s.shared_blks_read as blks,
        regexp_replace(left(s.query, 260), '\\s+', ' ', 'g') as q
      from pg_stat_statements s join pg_database d on d.oid = s.dbid
      where s.query !~* '^\\s*(begin|commit|rollback|savepoint|release|set |select set_config|create |alter |drop |truncate|copy |insert into drizzle|select pg_stat)'
        and d.datname not in ('postgres','template1')
      order by ${order} desc limit 40`);
    const print = (title: string, rows: Row[]) => {
      console.log(`[pgss] === ${title}`);
      console.log("[pgss] rank | calls | total_ms | mean_ms | rows | blks | query");
      for (const [i, r] of rows.entries())
        console.log(
          `[pgss] ${i + 1} | ${r.calls} | ${r.total_ms} | ${r.mean_ms} | ${r.rows} | ${r.blks} | ${r.q}`,
        );
    };
    print("top theo total_exec_time", (await q("s.total_exec_time")) as unknown as Row[]);
    print("top theo calls", (await q("s.calls")) as unknown as Row[]);
  }
} catch (e) {
  console.log(`[pgss] bỏ qua: ${(e as Error).message}`);
} finally {
  await sql.end();
}

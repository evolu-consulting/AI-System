import { sql } from "file:///D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/scripts/sql.mjs";
import { readFileSync } from "node:fs";
const runs = JSON.parse(readFileSync("runs.json","utf8")).runs;
for (const [k,id] of Object.entries(runs)) {
  console.log(k, "|", sql(`select a.status, coalesce(a.error_code,''), a.test_exit_code, a.test_duration_ms, to_char(a.created_at,'HH24:MI:SS.MS'), to_char(a.updated_at,'HH24:MI:SS.MS'), round(extract(epoch from a.updated_at-a.created_at)::numeric,1) from hub.autofix_applies a where process_run_id='${id}' order by created_at limit 1`));
  console.log("   jobs:", sql(`select status||'/'||coalesce(error_code,'') ||' '||to_char(started_at,'HH24:MI:SS')||'-'||to_char(finished_at,'HH24:MI:SS') from hub.jobs where type='source.apply' and payload->>'process_run_id'='${id}' order by created_at`).replace(/\n/g," ; "));
}
console.log("failed apply jobs total:", sql("select count(*) from hub.jobs where type='source.apply' and status='failed' and created_at > now() - interval '40 minutes'"));
console.log("apply jobs by status (40m):", sql("select status,count(*) from hub.jobs where type='source.apply' and created_at > now() - interval '40 minutes' group by 1").replace(/\n/g," ; "));

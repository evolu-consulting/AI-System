import { sql } from "file:///D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/scripts/sql.mjs";
for (const id of ["d7f190a2-8449-42a6-84f0-1aeb91b0b54b","7fed6db8-a812-442a-8855-7eb441964aad"]) {
console.log(sql(`select to_char(j.created_at,'HH24:MI:SS.MS'), to_char(j.finished_at,'HH24:MI:SS.MS') from hub.jobs j where type='source.apply' and payload->>'process_run_id'='${id}'`));
console.log(sql(`select to_char(a.created_at,'HH24:MI:SS.MS'), to_char(a.updated_at,'HH24:MI:SS.MS') from hub.autofix_applies a where process_run_id='${id}'`));
console.log(sql(`select to_char(finished_at,'HH24:MI:SS.MS'), status from hub.process_runs where id='${id}'`));
}
console.log(sql("select column_name from information_schema.columns where table_schema='hub' and table_name='review_tasks'").replace(/\n/g,","));

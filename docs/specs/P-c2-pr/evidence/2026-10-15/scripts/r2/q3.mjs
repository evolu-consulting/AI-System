import { sql } from "file:///D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/scripts/sql.mjs";
for (const id of ["d7f190a2-8449-42a6-84f0-1aeb91b0b54b","7fed6db8-a812-442a-8855-7eb441964aad","edd5f1f2-a455-472d-ab98-fbc90ca2898f"]) console.log(sql(`select to_char(decided_at,'HH24:MI:SS.MS') from hub.review_tasks where process_run_id='${id}' order by decided_at desc limit 1`));

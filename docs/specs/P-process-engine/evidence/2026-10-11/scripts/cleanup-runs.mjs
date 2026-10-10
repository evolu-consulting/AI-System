// dọn run đang treo (needs_decision) của lan để không chạm trần 5 lượt cùng lúc
import { hub, apiTok } from "./lib.mjs";
import { execFileSync } from "node:child_process";
const ids = execFileSync("docker", ["exec", "ai-system-postgres-1", "psql", "-U", "ai", "-d", "ai_system", "-Atc", "select id from hub.process_runs where status in ('needs_decision','running','waiting_review','waiting_answer')"]).toString().trim().split("\n").filter(Boolean);
const t = await apiTok("lan");
for (const id of ids) console.log(id, (await hub(t, "POST", `/process-runs/${id}/cancel`, {})).s);

import {login,hub} from "./lib.mjs";
import {spawnSync} from "node:child_process";
const t=await login("evolu","thomas.tran");
const ids=spawnSync("docker",["exec","ai-system-postgres-1","psql","-U","ai","-d","ai_system","-tA","-c","select id from hub.process_runs where status in ('running','needs_decision','waiting_answer','waiting_review')"]).stdout.toString().trim().split("\n").filter(Boolean);
for(const id of ids){const c=await hub(t,"POST",`/process-runs/${id}/cancel`,{});console.log(id,c.status);}

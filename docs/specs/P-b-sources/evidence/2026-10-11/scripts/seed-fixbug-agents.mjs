// Tạo 2 agent chuyên trách fixbug (system prompt VERBATIM từ fixbug-evolu-design.md mục "## Agents").
import {readFileSync,writeFileSync} from "node:fs";
import {execSync} from "node:child_process";
const md=readFileSync(new URL("../fixbug-evolu-design.md",import.meta.url),"utf8").split(/\r?\n/);
const pr=(h)=>{const i=md.findIndex(l=>l.startsWith("**System prompt `"+h+"`"));return md.slice(i+1).find(l=>l.startsWith("> ")).slice(2)};
const T="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const A=[["fixbug-engineer",'{"vi":"Fixbug - Kỹ sư","en":"Fixbug engineer"}',"Kỹ sư fixbug: đọc mã thật (chỉ-đọc) rồi chẩn đoán, lập kế hoạch và xuất patch dạng tài liệu."],
["fixbug-reviewer",'{"vi":"Fixbug - Reviewer độc lập","en":"Fixbug reviewer"}',"Reviewer độc lập fixbug: đối chiếu patch với mã thật và chuẩn repo, không rubber-stamp."]];
let sql="";
for(const [k,n,d] of A) sql+=`insert into hub.agents (key,name,description,runtime,profile_id,system_prompt,timeout_s,token_budget) values ('${k}','${n}','${d}','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61',$P$${pr(k)}$P$,900,1000000) on conflict (key) do update set system_prompt=excluded.system_prompt,token_budget=excluded.token_budget,timeout_s=excluded.timeout_s;\n`;
sql+=`insert into hub.agent_entitlements (agent_id,tenant_id) select id,'${T}' from hub.agents where key in ('fixbug-engineer','fixbug-reviewer') on conflict do nothing;
insert into hub.agent_grants (agent_id,tenant_id,subject_type,subject_id) select a.id,'${T}','user',u.id from hub.agents a, admin.users u where a.key in ('fixbug-engineer','fixbug-reviewer') and u.tenant_id='${T}' and not exists (select 1 from hub.agent_grants g where g.agent_id=a.id and g.subject_id=u.id);
select key,length(system_prompt),token_budget from hub.agents where key like 'fixbug-%';\n`;
writeFileSync(new URL("./seed-fixbug-agents.sql",import.meta.url),sql);
console.log(execSync("docker exec -i ai-system-postgres-1 psql -U ai -d ai_system -tA",{input:sql}).toString());

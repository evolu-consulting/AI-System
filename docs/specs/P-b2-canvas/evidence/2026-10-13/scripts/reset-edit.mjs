// Đưa pb2-uat-edit về trạng thái ban đầu (4 stage tuần tự, không step, không back; stage 4 không có Bàn giao).
import {login,hub} from "./lib.mjs";import {execSync} from "node:child_process";
const t=await login("evolu","julian.bui");const l=await hub(t,"GET","/process-defs?include_templates=false&limit=100");
const d=l.json.items.find(x=>x.key==="pb2-uat-edit");const full=(await hub(t,"GET","/process-defs/"+d.id)).json;
const names={"phan-tich":"Phân tích","ra-soat":"Rà soát code","test":"Test hồi quy","tong-hop":"Tổng hợp"};
const stages=Object.entries(names).map(([k,n])=>({key:k,name:n,after:{kind:"review",group_id:"a7ed5de4-bb6f-45bb-bdd7-a4f5598983be",back_to_steps:[]},
 output:{fields:[],filename:k+".md",template:"## Kết quả\n",required_sections:["Kết quả"]},sources:[],answerer:{kind:"starter"},
 executor:{kind:"agent",agent_id:"e405c9d8-3988-44e3-930a-fe3496504c77"},must_know:[],timeout_s:600,instruction:"Viết ngắn. #fake:sections=Kết quả|Bàn giao",real_action:false,token_budget:null}));
const body={key:full.key,name:full.name,description:full.description,input_hint:full.input_hint,run_group_ids:[],stages,token_budget:null,enabled:true,sources:[],inputs:[],version:full.version};
const r=await hub(t,"PUT","/process-defs/"+d.id,body);console.log("put",r.status,JSON.stringify(r.json).slice(0,200));
console.log(execSync("docker exec -i ai-system-postgres-1 psql -U ai -d ai_system < strip-handoff.sql").toString());

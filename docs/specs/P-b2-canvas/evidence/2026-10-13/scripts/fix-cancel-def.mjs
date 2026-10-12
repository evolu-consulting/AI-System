import {login,hub} from "./lib.mjs";import {q} from "./lib2.mjs";
const t=await login("evolu","julian.bui");const tt=await login("evolu","thomas.tran");
for(const id of q("select id from hub.process_runs where status not in ('done','cancelled','failed') and started_by=(select id from admin.users where username='thomas.tran')").split("\n").filter(Boolean)){const r=await hub(tt,"POST",`/process-runs/${id}/cancel`);console.log("cancel",id,r.status);}
const l=await hub(t,"GET","/process-defs?include_templates=false&limit=100");const d=l.json.items.find(x=>x.key==="pb2-uat-cancel");const full=(await hub(t,"GET","/process-defs/"+d.id)).json;
const ren={a:"nhanh-a",b:"nhanh-b",c:"chot"};const stages=full.stages.map(s=>({...s,key:ren[s.key]??s.key}));
const body={key:full.key,name:full.name,description:full.description,input_hint:full.input_hint,run_group_ids:[],stages,token_budget:null,enabled:true,sources:[],inputs:[],version:full.version};
const r=await hub(t,"PUT","/process-defs/"+d.id,body);console.log("put",r.status,JSON.stringify(r.json).slice(0,150));

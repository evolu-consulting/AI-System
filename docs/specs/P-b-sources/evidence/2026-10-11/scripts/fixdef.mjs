import {login,hub} from "./lib.mjs";
const j=await login("evolu","julian.bui");
const l=await hub(j,"GET","/process-defs?limit=50"); const d=l.json.items.find(x=>x.key==="doc-nguon-fake");
const g=await hub(j,"GET","/process-defs/"+d.id); const def=g.json;
console.log(Object.keys(def).join(","), def.version);
const body={key:def.key,name:def.name,description:def.description,input_hint:def.input_hint,run_group_ids:def.run_group_ids,stages:def.stages,token_budget:def.token_budget,enabled:def.enabled,sources:def.sources,inputs:[{key:"ghichu",label:"Ghi chú",type:"text",required:false}],version:def.version};
const r=await hub(j,"PUT","/process-defs/"+d.id,body); console.log(r.status,JSON.stringify(r.json).slice(0,300));

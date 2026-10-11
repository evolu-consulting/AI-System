import {login,hub} from "./lib.mjs";
const j=await login("evolu","julian.bui");const l=await hub(j,"GET","/process-defs?limit=50");
for(const d of l.json.items.filter(x=>x.key.startsWith("fixbug-evolu"))){const r=await hub(j,"DELETE",`/process-defs/${d.id}?version=${d.version}`);console.log(d.key,r.status,JSON.stringify(r.json));}

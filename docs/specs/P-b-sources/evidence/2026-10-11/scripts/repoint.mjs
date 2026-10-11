import {login,hub} from "./lib.mjs";
const p=await login("platform","admin"), t=await login("evolu","thomas.tran");
const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const g=await hub(p,"GET",`/admin/sources/ai-system-repo?tenant_id=${EV}`);
const r=await hub(p,"PUT",`/admin/sources/ai-system-repo?tenant_id=${EV}`,{version:g.json.version,description:g.json.description,config:{kind:"local_path",path:"/mnt/d/AI/ai-system/.data/uat-source"}});
console.log("repoint",r.status,JSON.stringify(r.json).slice(0,200));
const run=process.argv[2]; if(run){const c=await hub(t,"POST",`/process-runs/${run}/cancel`,{}); console.log("cancel",c.status,JSON.stringify(c.json).slice(0,200));}

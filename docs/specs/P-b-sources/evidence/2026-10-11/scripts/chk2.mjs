import {login,hub} from "./lib.mjs";
const p=await login("platform","admin");const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const c=await hub(p,"POST",`/admin/sources/ai-system-local/check?tenant_id=${EV}`);console.log(c.status,JSON.stringify(c.json));

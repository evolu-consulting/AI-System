import {login,hub} from "./lib.mjs";const t=await login("evolu","thomas.tran");
const c=await hub(t,"POST",`/process-runs/${process.argv[2]}/cancel`,{});console.log("cancel",c.status);

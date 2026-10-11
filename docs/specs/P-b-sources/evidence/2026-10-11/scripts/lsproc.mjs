import {login,hub} from "./lib.mjs";const t=await login("evolu","thomas.tran");const r=await hub(t,"GET","/processes");console.log(r.status,JSON.stringify(r.json));

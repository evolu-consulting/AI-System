import {jobs,sessions} from "./lib2.mjs";import {writeFileSync} from "node:fs";
const [id,name]=process.argv.slice(2);const j=jobs(id);
let t=`run ${id}\ncli_sessions hiện tại:\n${sessions(id)}\n\n`;
j.forEach((x,i)=>{t+=`--- job ${i+1} status=${x.status} provider=${x.provider_key} use_session=${x.use_session} created=${x.created_at} err=${x.error_code}\n${x.prompt}\n\n`;});
writeFileSync("../"+name,t);console.log(t.slice(0,600));

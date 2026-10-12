import {execFileSync} from "node:child_process";
import {login,hub} from "./lib.mjs";
export {login,hub};
export const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
export const q=(s)=>execFileSync("docker",["exec","ai-system-postgres-1","psql","-U","ai","-d","ai_system","-tA","-F","|","-c",s]).toString().trim();
export const tokens={};
export async function tk(u){return tokens[u]??=await login("evolu",u);}
export async function view(u,id){const r=await hub(await tk(u),"GET","/process-runs/"+id);return r.json;}
export async function start(u,key,input){const r=await hub(await tk(u),"POST","/process-runs",{process_key:key,input,origin:{kind:"none"}});if(r.status!==201)throw new Error("start "+r.status+JSON.stringify(r.json));return r.json.id;}
export async function waitRun(id,pred,ms=240000,u="vio.ngo"){const t0=Date.now();let v;while(Date.now()-t0<ms){v=await view(u,id);if(pred(v))return v;await sleep(2000);}throw new Error("timeout run "+id+" status="+v?.status+" "+JSON.stringify(v?.stages?.map(s=>s.status)));}
export const openTask=(v)=>[...(v.my_tasks??[]),...(v.open_tasks??[])];
export const jobs=(runId)=>JSON.parse(q(`select coalesce(json_agg(j order by j.created_at),'[]') from (select j.id,j.status,j.provider_key,j.agent_id,j.payload->>'use_session' use_session,j.payload->>'prompt' prompt,j.payload->>'session_id' sid,j.created_at, j.error_code from hub.jobs j join hub.process_runs p on p.conversation_id=j.conversation_id where p.id='${runId}' and j.type not like 'source%') j`)||"[]");
export const sessions=(runId)=>q(`select s.agent_id,s.provider_key,s.session_id,s.updated_at from hub.cli_sessions s join hub.process_runs p on p.conversation_id=s.conversation_id where p.id='${runId}'`);

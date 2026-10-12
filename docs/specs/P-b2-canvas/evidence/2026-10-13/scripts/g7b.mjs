// G-7 ca hỏi lại + ca hai stage cùng bước cùng agent.
import {start,waitRun,openTask,view,hub,tk,jobs,sessions,sleep} from "./lib2.mjs";
const L=console.log;
// hỏi lại
let id=await start("thomas.tran","pb2-uat-claude-ask","viết lời chào ngắn cho khách");L("ask run",id);
let v=await waitRun(id,v=>["waiting_answer","needs_decision","done"].includes(v.status),240000,"thomas.tran");L("status",v.status);
L("sessions trước trả lời:\n"+sessions(id));
const t=openTask(v).filter(t=>t.status==="open");L("tasks",JSON.stringify(t.map(x=>[x.id,x.kind,x.question??x.stage_name])));
if(t[0]?.kind==="ask"){
 const r=await hub(await tk("thomas.tran"),"POST",`/review-tasks/${t[0].id}/answer`,{answer:"thân mật"});L("answer",r.status,JSON.stringify(r.json).slice(0,200));
 v=await waitRun(id,v=>["done","needs_decision","waiting_review"].includes(v.status),240000,"thomas.tran");L("final",v.status);
}
const j=jobs(id);L(JSON.stringify(j.map(x=>({st:x.status,us:x.use_session,pk:x.provider_key}))));L("PROMPT cuối:\n"+j.at(-1)?.prompt);L("sessions sau:\n"+sessions(id));
// song song cùng agent
id=await start("thomas.tran","pb2-uat-claude-par","chủ đề: kiểm thử phần mềm");L("par run",id);
v=await waitRun(id,v=>["done","needs_decision"].includes(v.status),300000,"thomas.tran");L("final",v.status);
const jp=jobs(id);L(JSON.stringify(jp.map(x=>({st:x.status,us:x.use_session,pk:x.provider_key,plen:x.prompt?.length}))));L("sessions:\n"+sessions(id));

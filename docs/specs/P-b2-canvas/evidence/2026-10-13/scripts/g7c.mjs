// G-7 ca session quá hạn (>86400 s) => chạy mới, phiên mới.
import {q,start,waitRun,openTask,hub,tk,jobs,sessions} from "./lib2.mjs";
const L=console.log;
const id=await start("thomas.tran","pb2-uat-claude1","chủ đề: phiên hết hạn");L("run",id);
let v=await waitRun(id,v=>v.status==="waiting_review");
L("sessions:\n"+sessions(id));
q(`update hub.cli_sessions s set updated_at=now()-interval '2 days' from hub.process_runs p where p.id='${id}' and p.conversation_id=s.conversation_id`);
L("sau khi làm cũ 2 ngày:\n"+sessions(id));
const t=openTask(v).filter(t=>t.status==="open")[0];
const r=await hub(await tk("vio.ngo"),"POST",`/review-tasks/${t.id}/decision`,{result:"fail",feedback:"Làm ngắn hơn."});L("fail",r.status);
await new Promise(r=>setTimeout(r,4000));
v=await waitRun(id,v=>v.status==="waiting_review"&&openTask(v).some(x=>x.status==="open"&&x.id!==t.id));
const j=jobs(id);L(JSON.stringify(j.map(x=>({st:x.status,us:x.use_session,plen:x.prompt?.length}))));L("PROMPT redo:\n"+j.at(-1).prompt.slice(0,500));L("sessions sau:\n"+sessions(id));
const t2=openTask(v).filter(x=>x.status==="open")[0];
await hub(await tk("vio.ngo"),"POST",`/review-tasks/${t2.id}/cancel`).catch(()=>{});
await hub(await tk("thomas.tran"),"POST",`/process-runs/${id}/cancel`);

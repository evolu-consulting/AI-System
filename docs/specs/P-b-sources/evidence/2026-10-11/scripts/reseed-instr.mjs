// Reseed CHỈ instruction (b) từ fixbug-evolu-design.md; GIỮ allowlist/budget/sources hiện có. Chạy trong thư mục scripts/.
import {login,hub} from "./lib.mjs";
import {readFileSync} from "node:fs";
const md=readFileSync(new URL("../fixbug-evolu-design.md",import.meta.url),"utf8").split(/\r?\n/);
const bq=(a,b)=>md.slice(a,b).filter(l=>l.startsWith("> ")).map(l=>l.slice(2)).join("\n");
const iK=md.findIndex(l=>l.startsWith("## Khung chung"));
const khung=bq(iK,iK+4); // design đã chứa định dạng + quy tắc chỉ-trích-file-đã-đọc
const st=[1,2,3,4].map(n=>md.findIndex(l=>l.startsWith("## Stage "+n)));
const end=md.findIndex(l=>l.startsWith("## Allowlist gợi ý"));
const instr=st.map((s,i)=>khung+"\n\n"+bq(s,i<3?st[i+1]:end));
const j=await login("evolu","julian.bui");
const list=await hub(j,"GET","/process-defs");
const defs=(list.json.items??list.json).filter(d=>d.key.startsWith("fixbug-evolu"));
for(const d of defs){
  const g=(await hub(j,"GET","/process-defs/"+d.id)).json;
  console.log(g.key,"allowlist trước:",g.stages.map(s=>s.sources[0].allowlist.length+":"+s.sources[0].allowlist[0]).join(" | "));
  g.stages.forEach((s,i)=>{s.instruction=instr[i];});
  const body={key:g.key,name:g.name,description:g.description,input_hint:g.input_hint,run_group_ids:g.run_group_ids,stages:g.stages,token_budget:g.token_budget,enabled:g.enabled,sources:g.sources,inputs:g.inputs,version:g.version};
  const r=await hub(j,"PUT","/process-defs/"+g.id,body); console.log(" PUT",r.status,JSON.stringify(r.json).slice(0,150));
  const a=(await hub(j,"GET","/process-defs/"+g.id)).json;
  console.log(" allowlist sau:",a.stages.map(s=>s.sources[0].allowlist.length+":"+s.sources[0].allowlist[0]).join(" | "),"| có dòng mới:",a.stages.every(s=>s.instruction.includes("CHỈ trích file bạn đã THỰC SỰ")||s.instruction.includes("đã đọc ở bước này")));
}

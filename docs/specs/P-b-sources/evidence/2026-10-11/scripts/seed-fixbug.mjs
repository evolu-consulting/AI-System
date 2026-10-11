// Seed quy trình fixbug-evolu (+ bản fixbug-evolu-verify thu hẹp) trên tenant evolu. Instruction lấy VERBATIM từ fixbug-evolu-design.md.
import {login,hub} from "./lib.mjs";
import {execSync} from "node:child_process";
import {readFileSync} from "node:fs";
const q=(s)=>execSync(`docker exec ai-system-postgres-1 psql -U ai -d ai_system -tA -c "${s}"`).toString().trim();
const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const md=readFileSync(new URL("../fixbug-evolu-design.md",import.meta.url),"utf8").split(/\r?\n/);
const bq=(from,to)=>md.slice(from,to).filter(l=>l.startsWith("> ")).map(l=>l.slice(2)).join("\n");
const iKhung=md.findIndex(l=>l.startsWith("## Khung chung"));
// BỔ SUNG DUY NHẤT so với design (qc-uat): định dạng dòng trích dẫn mà checker Hub yêu cầu (`key:path@version`); design chưa nêu ⇒ mọi attempt bị template_invalid.
const FMT="Định dạng mỗi dòng trong `## Nguồn tham chiếu` (BẮT BUỘC, mỗi file đã đọc một dòng, KHÔNG có dấu gạch đầu dòng (-) hay số thứ tự, không bọc trong khối mã): `ai-system-local:<đường-dẫn-trong-nguồn>@<phiên-bản ghi trong MANIFEST>` — đường dẫn tính từ gốc nguồn (không kèm `sources/ai-system-local/`), ví dụ `ai-system-local:apps/hub-api/src/x.ts@<phiên-bản>`.";
const khung=bq(iKhung,iKhung+4)+"\n"+FMT;
const starts=[1,2,3,4].map(n=>md.findIndex(l=>l.startsWith("## Stage "+n)));
const end=md.findIndex(l=>l.startsWith("## Allowlist gợi ý"));
const instr=starts.map((s,i)=>khung+"\n\n"+bq(s,i<3?starts[i+1]:end));
const eng=q("select id from hub.agents where key='fixbug-engineer'"), rev=q("select id from hub.agents where key='fixbug-reviewer'");
const groupId=q("select id from admin.groups where key='fixbug-runners'");
const p=await login("platform","admin"); const j=await login("evolu","julian.bui");
let r=await hub(p,"POST","/admin/sources",{key:"ai-system-local",kind:"local_path",config:{kind:"local_path",path:"/mnt/d/AI/ai-system"},description:"Mã nguồn + tài liệu repo AI System (chỉ-đọc, local_path trên máy Runtime) - dùng cho quy trình fixbug-evolu.",tenant_id:EV});
console.log("source",r.status,JSON.stringify(r.json).slice(0,200));
const REF="Nguồn tham chiếu";
const STG=[
 ["chan-doan","Chẩn đoán",["Tóm tắt lỗi","Vị trí nghi ngờ","Nguyên nhân gốc","Cách tái hiện","Câu hỏi còn mở",REF]],
 ["ke-hoach","Kế hoạch sửa",["Hướng sửa","Thay đổi dự kiến","Rủi ro & ảnh hưởng","Phương án thay thế",REF]],
 ["patch","Patch",["Patch","Giải thích","Việc thủ công còn lại",REF]],
 ["ra-soat","Rà soát & Test",["Kết luận","Rà soát","Test đề xuất","Trước khi merge",REF]],
];
const stage=(i,al,budget)=>{const [key,name,secs]=STG[i];return{key,name,executor:{kind:"agent",agent_id:i===3?rev:eng},instruction:instr[i],output:{filename:key+".md",template:secs.map(s=>"## "+s+"\n").join("\n"),required_sections:secs,fields:[]},after:{kind:"auto"},real_action:false,answerer:{kind:"starter"},timeout_s:900,token_budget:budget,sources:[{source_key:"ai-system-local",allowlist:al}],must_know:[]}};
const MOD="apps/hub-api/src/modules/**", CON="packages/contracts/src/**", CONV="docs/CONVENTIONS.md", SPEC="docs/specs/*/spec.md";
const variants={
 "fixbug-evolu":{name:"Sửa lỗi (4 bước)",al:[[MOD,CON,CONV,SPEC],[MOD,CON,CONV,SPEC],[MOD],[MOD,"tests/acceptance/**"]]},
 "fixbug-evolu-verify":{name:"Sửa lỗi (4 bước) - bản kiểm thu hẹp",al:(()=>{const S="apps/hub-api/src/modules/sources/**",C="packages/contracts/src/hub-admin/sources.ts";return[[S,C,CONV],[S,C,CONV],[S,C],[S,C,"tests/acceptance/P-b/**"]]})()},
};
for(const [key,v] of Object.entries(variants)){
 const body={key,name:v.name,description:"Mô tả lỗi → AI đọc code thật (chỉ-đọc) → Chẩn đoán, Kế hoạch, Patch, Rà soát. Agent không tự sửa repo.",input_hint:"Mô tả lỗi: triệu chứng + cách lặp + file nghi ngờ (nếu biết)",inputs:[],sources:["ai-system-local"],run_group_ids:[groupId],token_budget:null,enabled:true,stages:v.al.map((al,i)=>stage(i,al,1000000))};
 r=await hub(j,"POST","/process-defs",body); console.log(key,r.status,JSON.stringify(r.json).slice(0,300));
}

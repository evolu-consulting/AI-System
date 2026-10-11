import {login,hub} from "./lib.mjs";
import {execSync} from "node:child_process";
const q=(s)=>execSync(`docker exec ai-system-postgres-1 psql -U ai -d ai_system -tA -c "${s}"`).toString().trim();
const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const claude=q("select id from hub.agents where key='pb-doc-claude'"), fake=q("select id from hub.agents where key='pb-doc-fake'"), team=q("select id from hub.agent_teams where key='plan-team'");
const p=await login("platform","admin"); const j=await login("evolu","julian.bui");
let r=await hub(p,"POST","/admin/sources",{key:"ai-system-repo",kind:"local_path",config:{kind:"local_path",path:"/mnt/d/AI/ai-system"},description:"Mã nguồn + tài liệu dự án AI System (local_path trên máy Runtime) - nguồn demo P-b.",tenant_id:EV});
console.log("source",r.status,JSON.stringify(r.json).slice(0,300));
const stage=(key,name,exec,instr,sections,src,budget)=>({key,name,executor:exec,instruction:instr,output:{filename:key+".md",template:sections.map(s=>"## "+s+"\n").join("\n"),required_sections:sections,fields:[]},after:{kind:"auto"},real_action:false,answerer:{kind:"starter"},timeout_s:600,token_budget:budget??null,sources:src??[],must_know:[]});
const ALLOW=["packages/contracts/src/hub-admin/**","apps/hub-api/src/modules/sources/**","docs/specs/P-b-sources/spec.md"];
const src=[{source_key:"ai-system-repo",allowlist:ALLOW}];
const realInstr="Dùng công cụ Read/Grep/Glob đọc file sources/ai-system-repo/packages/contracts/src/hub-admin/sources.ts. Trả lời NGẮN (tối đa 8 dòng): (1) nguồn có những loại (kind) nào; (2) trần số file/dung lượng nếu thấy. Dưới mục '## Nguồn tham chiếu' liệt kê mỗi file đã đọc theo dạng ai-system-repo:đường-dẫn@phiên-bản (phiên-bản lấy từ MANIFEST).";
const defs=[
 {key:"doc-nguon-claude",name:"Rà nguồn tham chiếu (Claude thật)",description:"Demo P-b: agent Claude đọc nguồn local_path ai-system-repo và trích dẫn Nguồn tham chiếu.",input_hint:"Câu hỏi về nguồn",inputs:[{key:"cauhoi",label:"Câu hỏi thêm",type:"text",required:false}],sources:["ai-system-repo"],stages:[stage("doc","Đọc nguồn",{kind:"agent",agent_id:claude},realInstr,["Tóm tắt","Nguồn tham chiếu"],src,50000)]},
 {key:"doc-nguon-fake",name:"Rà nguồn tham chiếu (fake-cli)",description:"Demo P-b bằng fake-cli: kiểm luồng resolve/snapshot/MANIFEST/audit không tốn token.",input_hint:"Ghi chú",inputs:[{key:"repo",label:"Nguồn cần rà",type:"source_ref",required:true},{key:"ghichu",label:"Ghi chú",type:"text",required:false}],sources:["ai-system-repo"],stages:[stage("doc","Đọc nguồn",{kind:"agent",agent_id:fake},"Đọc nguồn ai-system-repo. #fake:read=sources/ai-system-repo/packages/contracts/src/hub-admin/sources.ts #fake:sections=Tóm tắt|Nguồn tham chiếu",["Tóm tắt","Nguồn tham chiếu"],src)]},
 {key:"nhom-stage0",name:"Nhóm ở giai đoạn 0 (kiểm #135)",description:"Quy trình có giai đoạn nhóm ngay stage 0 để kiểm member đầu không bị 401.",input_hint:"Mô tả",inputs:[],sources:[],stages:[stage("lap","Lập kế hoạch nhóm",{kind:"team",team_id:team},"Lập kế hoạch ngắn.",["Contract","DB","Tasks","Frontend"])]},
];
for(const d of defs){const b={...d,run_group_ids:[],token_budget:null,enabled:true};r=await hub(j,"POST","/process-defs",b);console.log(d.key,r.status,JSON.stringify(r.json).slice(0,400));}

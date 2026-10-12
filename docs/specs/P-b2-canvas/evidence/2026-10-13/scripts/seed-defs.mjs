// Seed quy trình UAT P-b2 trên tenant evolu qua API Hub (julian.bui). Chạy lại an toàn: bỏ qua key đã có.
import {login,hub} from "./lib.mjs";
const FAKE="e405c9d8-3988-44e3-930a-fe3496504c77", CLAUDE="22d23711-34f7-40e0-b862-de4865099877", REV="a7ed5de4-bb6f-45bb-bdd7-a4f5598983be";
const mk=(key,name,agent,instr,sections,opt={})=>({key,name,
  after: opt.review?{kind:"review",group_id:REV,back_to_steps:opt.back??[]}:{kind:"auto"},
  output:{fields:[],filename:key+".md",template:sections.map(s=>"## "+s+"\n").join("\n"),required_sections:sections},
  sources:[],answerer:{kind:"starter"},executor:{kind:"agent",agent_id:agent},must_know:[],timeout_s:600,
  instruction:instr,real_action:false,token_budget:opt.tb??null,...(opt.step!==undefined?{step:opt.step}:{})});
const F=(s)=>" #fake:sections="+s.join("|");
const defs=[];
// 1) Editor / canvas (tuần tự cũ, UI sẽ sửa thành song song)
{const S=["Kết quả"]; defs.push({key:"pb2-uat-edit",name:"UAT P-b2 canvas",description:"UAT P-b2: 4 giai đoạn tuần tự, sửa bằng canvas.",input_hint:"Mô tả",
 stages:[["phan-tich","Phân tích"],["ra-soat","Rà soát code"],["test","Test hồi quy"],["tong-hop","Tổng hợp"]].map(([k,n])=>mk(k,n,FAKE,"Viết ngắn."+F(["Kết quả","Bàn giao"]),S,{review:true}))});}
// 2) Huỷ run: bước 0 = [A fake duyệt, B Claude tự chạy (chậm)]
defs.push({key:"pb2-uat-cancel",name:"UAT P-b2 huỷ khi song song",description:"UAT",input_hint:"Mô tả",
 stages:[mk("nhanh-a","Nhánh nhanh (fake)",FAKE,"Viết ngắn."+F(["Kết quả","Bàn giao"]),["Kết quả","Bàn giao"],{review:true,step:0}),
 mk("nhanh-b","Nhánh chậm (Claude)",CLAUDE,"Viết một đoạn khoảng 120 từ về lợi ích của việc kiểm thử. Mục 'Kết quả': đoạn đó. Mục 'Bàn giao': 1 câu.",["Kết quả","Bàn giao"],{step:0}),
 mk("chot","Chốt (fake)",FAKE,"Viết ngắn."+F(["Kết quả","Bàn giao"]),["Kết quả","Bàn giao"],{step:1})]});
// 3) Claude thật: redo cùng agent (resume) rồi stage sau cùng agent (phiên mới)
defs.push({key:"pb2-uat-claude1",name:"UAT P-b2 Claude: resume",description:"UAT G-7",input_hint:"Chủ đề",
 stages:[mk("soan","Soạn",CLAUDE,"Viết một câu chào ngắn về chủ đề người dùng nêu. Mục 'Nội dung': đúng một câu. Mục 'Bàn giao': đúng một câu tóm tắt cho bước sau.",["Nội dung","Bàn giao"],{review:true}),
 mk("mo-rong","Mở rộng",CLAUDE,"Dựa trên khối Bàn giao, viết thêm đúng một câu. Mục 'Nội dung': câu đó. Mục 'Bàn giao': một câu.",["Nội dung","Bàn giao"])]});
// 4) Claude thật: hai stage cùng bước cùng agent => use_session=false
defs.push({key:"pb2-uat-claude-par",name:"UAT P-b2 Claude: song song cùng agent",description:"UAT G-7",input_hint:"Chủ đề",
 stages:[mk("nhanh-a","Nhánh A",CLAUDE,"Viết một câu về chủ đề. Mục 'Nội dung': đúng một câu. Mục 'Bàn giao': một câu.",["Nội dung","Bàn giao"],{step:0}),
 mk("nhanh-b","Nhánh B",CLAUDE,"Viết một câu khác về chủ đề. Mục 'Nội dung': đúng một câu. Mục 'Bàn giao': một câu.",["Nội dung","Bàn giao"],{step:0})]});
// 5) Claude thật: hỏi lại + trả lời
defs.push({key:"pb2-uat-claude-ask",name:"UAT P-b2 Claude: hỏi lại",description:"UAT G-7",input_hint:"Chủ đề",
 stages:[mk("hoi","Hỏi rồi viết",CLAUDE,"Trước khi viết, BẮT BUỘC hỏi lại người dùng: 'Bạn muốn giọng văn trang trọng hay thân mật?' (trả need_input với đúng câu hỏi đó, choices: [\"trang trọng\",\"thân mật\"]). Sau khi có câu trả lời mới viết. Mục 'Nội dung': một câu theo giọng đã chọn. Mục 'Bàn giao': một câu.",["Nội dung","Bàn giao"])]});
const t=await login("evolu","julian.bui");
for(const d of defs){const r=await hub(t,"POST","/process-defs",{...d,run_group_ids:[],token_budget:null,enabled:true,sources:[],inputs:[]});console.log(d.key,r.status,JSON.stringify(r.json).slice(0,300));}

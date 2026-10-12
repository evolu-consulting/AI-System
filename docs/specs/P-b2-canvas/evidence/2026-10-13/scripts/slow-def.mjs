import {login,hub} from "./lib.mjs";
const t=await login("evolu","julian.bui");
const l=await hub(t,"GET","/process-defs?include_templates=false&limit=100");const d=l.json.items.find(x=>x.key==="pb2-uat-cancel");const full=(await hub(t,"GET","/process-defs/"+d.id)).json;
const stages=full.stages.map(s=>s.key==="nhanh-b"?{...s,instruction:"Viết MƯỜI đoạn văn, mỗi đoạn khoảng 90 từ, về mười lợi ích khác nhau của việc kiểm thử phần mềm (đánh số 1..10). Mục 'Kết quả': mười đoạn đó. Mục 'Bàn giao': 1 câu."}:s);
const body={key:full.key,name:full.name,description:full.description,input_hint:full.input_hint,run_group_ids:[],stages,token_budget:null,enabled:true,sources:[],inputs:[],version:full.version};
const r=await hub(t,"PUT","/process-defs/"+d.id,body);console.log("put",r.status);

// Gỡ + thêm lại thomas.tran vào fixbug-runners qua Admin API để Hub nạp lại cache nhóm (group tạo bằng SQL không có sự kiện).
import {login,AUTH} from "./lib.mjs";
const j=await login("evolu","julian.bui");const H={authorization:"Bearer "+j,"content-type":"application/json"};
const G="6156e23d-5373-4eb9-8a91-cb71674af96f";
const us=await (await fetch(AUTH+"/admin/users?q=thomas.tran",{headers:H})).json();
const u=(us.items||[]).find(x=>x.username==="thomas.tran");console.log("user",u?.id);

await fetch(`${AUTH}/admin/groups/${G}/members/${u.id}`,{method:"DELETE",headers:H});
const r=await fetch(`${AUTH}/admin/groups/${G}/members`,{method:"POST",headers:H,body:JSON.stringify({usernames:["thomas.tran"]})});console.log("add",r.status,(await r.text()).slice(0,200));

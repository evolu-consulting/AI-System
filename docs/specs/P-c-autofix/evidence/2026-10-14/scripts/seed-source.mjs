import {login,hub} from "./api.mjs";
const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const p=await login("platform","admin");
let r=await hub(p,"POST","/admin/sources",{key:process.argv[2]||"uat-calc",kind:"local_path",config:{kind:"local_path",path:"/work/.data/uat-autofix-repo"},description:"uat- repo nhỏ có 1 bug add(a,b) (P-c1 UAT)",tenant_id:EV});
console.log(r.status,JSON.stringify(r.json).slice(0,300));
r=await hub(p,"POST","/admin/sources/"+(process.argv[2]||"uat-calc")+"/check?tenant_id="+EV,{});
console.log("check",r.status,JSON.stringify(r.json).slice(0,300));

import {login,AUTH} from "./lib.mjs";
const j=await login("evolu","julian.bui");const H={authorization:"Bearer "+j,"content-type":"application/json"};
const id="01a11c1d-cc1f-7000-b8a8-7914b78c0c55";
const g=await (await fetch(`${AUTH}/admin/users/${id}`,{headers:H})).json();console.log(Object.keys(g).join(","),g.version);
const r=await fetch(`${AUTH}/admin/users/${id}`,{method:"PATCH",headers:H,body:JSON.stringify({display_name:g.display_name,version:g.version})});console.log(r.status,(await r.text()).slice(0,200));

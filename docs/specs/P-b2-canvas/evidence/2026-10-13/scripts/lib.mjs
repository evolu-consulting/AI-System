export const AUTH="http://localhost:3001", HUB="http://localhost:4000";
export async function login(tenant_key, username, password="1234567890"){
  const r=await fetch(AUTH+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenant_key,username,password})});
  const j=await r.json(); if(!j.access_token) throw new Error(tenant_key+"/"+username+" "+r.status+" "+JSON.stringify(j)); return j.access_token;
}
export async function hub(t,m,p,b){const r=await fetch(HUB+p,{method:m,headers:{authorization:"Bearer "+t,"content-type":"application/json"},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json()}catch{}return{status:r.status,json:j}}

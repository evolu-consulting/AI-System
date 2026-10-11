// Đếm file khớp allowlist (xấp xỉ B3 walk: bỏ node_modules/.git/dist... bằng git ls-files + file chưa theo dõi).
import {execSync} from "node:child_process";
const files=execSync("git ls-files -co --exclude-standard",{cwd:"D:/AI/ai-system",maxBuffer:1e9}).toString().split("\n").filter(Boolean);
const re=(g)=>{let s="";for(let i=0;i<g.length;i++){const c=g[i];
 if(c==="*"&&g[i+1]==="*"){if(g[i+2]==="/"){s+="(.*/)?";i+=2}else{s+=".*";i+=1}}
 else if(c==="*")s+="[^/]*"; else s+=c.replace(/[.+^${}()|[\]\\]/g,"\\$&");}
 return new RegExp("^"+s+"$");};
for(const set of process.argv.slice(2)){const rs=set.split(",").map(re);const m=files.filter(f=>rs.some(r=>r.test(f)));console.log(m.length,set)}

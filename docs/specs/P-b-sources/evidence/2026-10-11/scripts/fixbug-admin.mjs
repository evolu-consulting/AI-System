// (d) julian.bui (tenant_admin evolu) xem Nguồn: thấy ai-system-local nhưng KHÔNG thấy path. Ảnh -> fixbug-evolu/
import { launch, ctx, adminLogin, ADMIN } from "./h.mjs";
import { expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
const OUT="D:/AI/ai-system/docs/specs/P-b-sources/evidence/2026-10-11/fixbug-evolu";
const b=await launch(); const c=await ctx(b,ADMIN); const p=await c.newPage(); const bodies=[];
p.on("response",async r=>{if(r.url().includes("/admin/sources")){try{bodies.push(r.request().method()+" "+r.url()+" "+r.status()+"\n"+await r.text())}catch{}}});
await adminLogin(p,"evolu","julian.bui");
await p.getByRole("link",{name:/^(Nguồn|Sources)$/}).click();
const row=p.getByRole("table").getByRole("row").filter({hasText:"ai-system-local"});
await expect(row).toBeVisible(); await p.screenshot({path:`${OUT}/09-nguon-tenantadmin-list.png`});
await row.getByRole("button",{name:/ai-system-local/}).click().catch(()=>{});
const first=p.getByRole("menuitem").first(); if(await first.count()) await first.click();
await p.waitForTimeout(1200); await p.screenshot({path:`${OUT}/10-nguon-tenantadmin-detail.png`});
const txt=await p.locator("body").innerText(); const leakUI=txt.includes("/mnt/d")||txt.includes("AI/ai-system"); const leakAPI=bodies.join("").includes("/mnt/d");
const res={leakUI,leakAPI,api:bodies.join("\n\n").slice(0,1500)}; fs.writeFileSync(`${OUT}/nguon-tenantadmin-check.json`,JSON.stringify(res,null,1)); console.log(JSON.stringify({leakUI,leakAPI}));
await b.close();

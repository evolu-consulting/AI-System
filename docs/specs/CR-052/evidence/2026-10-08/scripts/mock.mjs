import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const M="C:/Users/MSI VN/AppData/Local/Temp/claude/C--Users-MSI-VN/991bb7da-f245-4df7-a375-b3cbda168b31/scratchpad/login/project/";
const O="D:/AI/ai-system/docs/specs/CR-052/evidence/2026-10-08/";
const b=await chromium.launch();
for(const n of ["Chat","Studio","Admin"]){const p=await b.newPage({viewport:{width:1440,height:900}});await p.goto("file:///"+M.replace(/ /g,"%20")+`C-${n}.dc.html`);await p.waitForTimeout(2000);await p.screenshot({path:O+`00-mockup-${n}.png`});console.log(n,(await p.locator("body").innerText()).slice(0,300).replace(/\n/g," | "));}
const p=await b.newPage();await p.goto("http://localhost:3200/studio/login");await p.waitForTimeout(1000);
console.log(await p.evaluate(()=>[...document.images].map(i=>i.src+" "+i.naturalWidth)));
await b.close();

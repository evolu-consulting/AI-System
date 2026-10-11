// Chụp thread output của run fixbug mới nhất (thomas.tran) + trang Nguồn (julian.bui).
import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const OUT="D:/AI/ai-system/docs/specs/P-b-sources/evidence/2026-10-11/fixbug-evolu";
const b=await chromium.launch({headless:true});
const mk=async(base)=>{const c=await b.newContext({locale:"vi-VN",viewport:{width:1360,height:860},baseURL:base});await c.addInitScript(()=>{try{localStorage.setItem("ai.locale","vi")}catch{}});return c.newPage();};
const p=await mk("http://localhost:3100");
await p.goto("/login");
await p.getByRole("textbox",{name:"Mã công ty"}).fill("evolu");await p.getByRole("textbox",{name:"Tên đăng nhập"}).fill("thomas.tran");
await p.getByLabel("Mật khẩu").fill("1234567890");await p.getByRole("button",{name:"Đăng nhập"}).click();await p.waitForURL(/\/c\/new$/);
await p.goto("/rooms/d2a00000-0000-4000-8000-000000000002");
await p.getByRole("textbox",{name:/Tin nhắn cho/}).waitFor();
await p.getByRole("button",{name:"Trả lời tiếp"}).last().click();
await p.waitForTimeout(2500);
await p.screenshot({path:`${OUT}/05-thread-open.png`});
const xem=p.getByRole("button",{name:/Xem nội dung/});console.log("xem",await xem.count());
await p.getByText("Giai đoạn 1").first().scrollIntoViewIfNeeded();await p.screenshot({path:`${OUT}/06-the-4-buoc-token.png`});
for(const [i,n] of [[3,"08-output-stage4-rasoat"],[2,"07-output-stage3-patch"]]){const b1=xem.nth(i);await b1.scrollIntoViewIfNeeded();await b1.click();await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/${n}.png`});}
await b.close();

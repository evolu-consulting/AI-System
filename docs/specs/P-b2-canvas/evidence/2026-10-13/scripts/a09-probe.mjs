// Kiểm sâu A09: PUT bị ép 4 stage cùng bước 0 (mô phỏng) => 422 thật từ Hub; ghi body 422 + mọi thông báo UI.
import { chromium, viCtx, EVD, adminLogin, openDef } from "./pw.mjs";
import { writeFileSync } from "node:fs";
const b = await chromium.launch();
const c = await viCtx(b, { width: 1440, height: 1000 });
const p = await c.newPage();
await adminLogin(p, "julian.bui");
await openDef(p, "pb2-uat-edit", "UAT P-b2 canvas");
await p.getByRole("application", { name: "Canvas quy trình" }).waitFor();
let body422 = null;
await p.route(/process-defs\/[0-9a-f-]+$/, async (route) => {
  const rq = route.request();
  if (rq.method() !== "PUT") return route.continue();
  const body = JSON.parse(rq.postData());
  body.stages.forEach((s) => { s.step = 0; });
  const resp = await route.fetch({ postData: JSON.stringify(body) });
  body422 = { status: resp.status(), text: await resp.text() };
  await route.fulfill({ response: resp });
});
const nm = p.getByRole("textbox", { name: "Tên giai đoạn" });
await nm.fill("Phân tích x");
await nm.fill("Phân tích");
await p.getByRole("button", { name: "Lưu", exact: true }).click();
await p.waitForTimeout(400);
const msgs = await p.evaluate(() => [...document.querySelectorAll('[role=alert],[role=status],[data-sonner-toast],[aria-live]')].map((e) => e.getAttribute("role") + "|" + e.textContent.trim()).filter(Boolean));
await p.getByRole("tablist", { name: "Chế độ xem" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
await p.screenshot({ path: `${EVD}/09-A-422-toast.png` });
for (const n of ["Phân tích", "Rà soát code", "Test hồi quy", "Tổng hợp"]) {
  await p.getByRole("button", { name: new RegExp(`^Giai đoạn \\d+: ${n}`) }).click();
  await p.waitForTimeout(300);
  const t = await p.getByRole("complementary", { name: "Chi tiết giai đoạn" }).innerText();
  msgs.push("PANEL " + n + " => " + t.replace(/\n+/g, " / ").slice(0, 400));
}
writeFileSync(EVD + "/a09-422-detail.txt", JSON.stringify(body422, null, 1) + "\n\n" + msgs.join("\n"));
console.log(JSON.stringify(body422).slice(0, 900));
console.log(msgs.join("\n"));
await b.close();

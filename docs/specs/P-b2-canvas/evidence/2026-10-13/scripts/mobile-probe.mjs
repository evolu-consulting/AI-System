// A11b: ở 390 px bấm một giai đoạn => panel chi tiết (Sheet) có mở không; thử cả 800 px (< 1024).
import { chromium, viCtx, EVD, adminLogin } from "./pw.mjs";
import { writeFileSync } from "node:fs";
const b = await chromium.launch();
const out = [];
for (const w of [390, 800]) {
  const c = await viCtx(b, { width: w, height: 900 });
  const q = await c.newPage();
  await adminLogin(q, "julian.bui");
  await q.goto("http://localhost:3000/processes");
  await q.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "pb2-uat-edit" }).getByRole("link", { name: "UAT P-b2 canvas" }).click();
  await q.waitForTimeout(1500);
  const sel = await q.getByRole("tablist", { name: "Chế độ xem" }).getByRole("tab", { name: "Danh sách" }).getAttribute("aria-selected");
  const btn = q.getByRole("button", { name: /^Giai đoạn 3: / });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await q.waitForTimeout(1200);
  const dlg = await q.getByRole("dialog").count();
  const comp = await q.getByRole("complementary", { name: "Chi tiết giai đoạn" }).isVisible().catch(() => false);
  const vis = await q.getByRole("region", { name: /^Giai đoạn 3: /, includeHidden: false }).first().isVisible().catch(() => false);
  out.push(`width ${w}: danh-sách-mặc-định=${sel} dialog=${dlg} complementary-visible=${comp} region-visible=${vis}`);
  await q.screenshot({ path: `${EVD}/11-A-mobile-click-${w}.png` });
  await c.close();
}
writeFileSync(EVD + "/a11-mobile-sheet.txt", out.join("\n"));
console.log(out.join("\n"));
await b.close();

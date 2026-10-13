import { launch, studioLogin, expect, mkSnap } from "./lib.mjs";
const OUT = process.argv[2];
const AG = Object.fromEntries(process.argv.slice(3).map((s) => s.split("=")));
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
await studioLogin(page);
for (const [k, id] of Object.entries(AG)) {
  await page.goto(`http://localhost:3200/studio/agents/${id}`);
  const r = page.getByRole("region", { name: "KnowledgeHub" });
  const cb = r.getByRole("checkbox", { name: "kh-main" });
  await expect(cb).toBeVisible();
  await cb.check();
  await r.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Đã lưu kết nối của agent");
  console.log("ticked", k);
}
await page.goto("http://localhost:3200/studio/settings");
await page.waitForTimeout(1500);
await snap(page, "28-B-settings-agents-count-6", true);
await browser.close();

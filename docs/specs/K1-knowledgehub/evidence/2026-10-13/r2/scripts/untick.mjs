import { launch, studioLogin, expect } from "./lib.mjs";
const AG = { "docs-architect": "48cf7e46-e21e-46f8-baa5-90f5fe22ed4c", "backend-lead": "81320bc4-2ac1-47e9-98b5-36b6db862e32" };
const { browser, page } = await launch(".");
await studioLogin(page);
for (const id of Object.values(AG)) {
  await page.goto(`http://localhost:3200/studio/agents/${id}`);
  const r = page.getByRole("region", { name: "KnowledgeHub" });
  const cb = r.getByRole("checkbox", { name: "kh-main" });
  await expect(cb).toBeVisible();
  await cb.uncheck();
  await r.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Đã lưu kết nối của agent");
  console.log("unticked", id);
}
await browser.close();

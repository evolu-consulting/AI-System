// UAT H4b-2 phần F: PROVIDER_HAS_HISTORY thật (provider có job lịch sử, không thuộc profile). Job lịch sử chèn bằng SQL (dữ liệu thử, xoá cuối bước).
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
import { sql } from "./sql.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const choose = async (box, label) => { const tag = await box.evaluate((e) => e.tagName.toLowerCase()); if (tag === "select") return box.selectOption({ label }); await box.click(); await page.getByRole("option", { name: label, exact: true }).click(); };
const agentId = () => sql("select id from hub.agents where key='pb-doc-fake'");
await studioLogin(page);
await step("F01", "HAS_HISTORY: provider uat-hist có job lịch sử, không thuộc profile ⇒ Xoá ⇒ 'Provider đã có lịch sử chạy, chỉ tắt được'", async () => {
  await page.goto("http://localhost:3200/studio/models");
  const table = page.getByRole("table", { name: "Danh sách provider" });
  await expect(table.getByRole("row").filter({ hasText: "claude-sub" })).toBeVisible();
  if (!(await table.getByRole("row").filter({ hasText: "uat-hist" }).count())) {
  await page.getByRole("button", { name: "+ Thêm provider" }).click();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("uat-hist");
  await choose(d.getByRole("combobox", { name: "Loại" }), "Subscription");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "Fake (dev)");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
  }
  const ref = sql("select tenant_id||'|'||user_id from hub.jobs order by created_at desc limit 1").split("|");
  sql(`insert into hub.jobs(tenant_id,user_id,type,agent_id,provider_key,status,payload) values ('${ref[0]}','${ref[1]}','agent.cli','${agentId()}','uat-hist','succeeded','{}')`);
  const row = table.getByRole("row").filter({ hasText: "uat-hist" }).first();
  await row.getByRole("button", { name: "Xoá" }).click();
  await page.getByRole("alertdialog", { name: "Xoá uat-hist?" }).getByRole("button", { name: "Xoá" }).click();
  await expect(page.getByText("Provider đã có lịch sử chạy, chỉ tắt được").first()).toBeVisible();
  await snap(page, "01-F-has-history");
  await expect(row).toBeVisible();
});

await step("F02", "Dọn: xoá job lịch sử, rồi Xoá uat-hist thành công", async () => {
  sql("delete from hub.jobs where provider_key='uat-hist'");
  const row = page.getByRole("table", { name: "Danh sách provider" }).getByRole("row").filter({ hasText: "uat-hist" }).first();
  await row.getByRole("button", { name: "Xoá" }).click();
  await page.getByRole("alertdialog", { name: "Xoá uat-hist?" }).getByRole("button", { name: "Xoá" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Đã xoá uat-hist");
  await snap(page, "02-F-deleted-after-history-cleared");
});
save();
await browser.close();

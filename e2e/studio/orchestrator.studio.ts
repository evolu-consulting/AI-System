// HUB-FR-62 · H4a-AC-08 · H4a-R07 · plan-frontend §3 (Orchestrator), §6 · test-plan H4a §3 E17
// Sheet "Thêm Orchestrator cho tenant": form tenant mới điền sẵn từ bản mặc định; tenant đã có bản riêng không được chọn.
import { expect, test } from "@playwright/test";
import { ID, mockStudio, openAuthed } from "./_support";

test("HUB-FR-62 · E17 · + Thêm cho tenant: Sheet điền sẵn từ bản mặc định (agent orchestrator, 5 / 200000 / 10); tenant đã có bản riêng (beta) không chọn được; lưu `acme` ⇒ POST /orchestrator/tenants + dòng acme [H4a-AC-08 · H4a-R07]", async ({
  page,
}) => {
  const s = await mockStudio(page, { session: true });
  await openAuthed(page, "/orchestrator");
  await expect(page.getByRole("heading", { name: "Orchestrator", exact: true })).toBeVisible();
  const tbl = page.getByRole("table", { name: "Orchestrator theo tenant" });
  await expect(tbl.getByRole("row").filter({ hasText: "Mặc định (toàn hệ thống)" })).toHaveCount(1);
  await expect(tbl.getByRole("row").filter({ hasText: "beta" })).toHaveCount(1);
  await expect(tbl.getByRole("row").filter({ hasText: "acme" })).toHaveCount(0);

  await page.getByRole("button", { name: "+ Thêm cho tenant" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm Orchestrator cho tenant" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("combobox", { name: "Agent làm Orchestrator" })).toContainText(
    "orchestrator",
  );
  await expect(dlg.getByRole("spinbutton", { name: "Số bước tối đa" })).toHaveValue("5");
  await expect(dlg.getByRole("spinbutton", { name: "Ngân sách token / run" })).toHaveValue(
    "200000",
  );
  await expect(dlg.getByRole("spinbutton", { name: "Số tin lịch sử" })).toHaveValue("10");

  await dlg.getByRole("combobox", { name: "Tenant" }).click();
  await expect(page.getByRole("option", { name: /beta/ })).toHaveCount(0);
  await page.getByRole("option", { name: /acme/ }).click();

  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/studio\/api\/orchestrator\/tenants$/.test(r.url()),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await post).postDataJSON()).toMatchObject({
    tenant_id: ID.acme,
    agent_id: ID.orch,
    max_steps: 5,
    token_budget: 200000,
    history_n: 10,
    on_no_match: "answer",
  });
  await expect(dlg).toBeHidden();
  await expect(tbl.getByRole("row").filter({ hasText: "acme" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(
    "Đã lưu Orchestrator · hub config v8",
  );
  expect(s.orchTenants.map((t) => t.tenant_id)).toContain(ID.acme);
});

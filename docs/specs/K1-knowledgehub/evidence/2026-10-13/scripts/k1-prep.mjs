// UAT K1 chuẩn bị (Admin evolu): nhóm Beta testers (review_group quy trình mẫu) + cấp quyền agent stage cho Beta testers.
import { launch, adminLogin, mkSnap, mkStep, expect } from "./lib.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
await adminLogin(page, "julian.bui", "evolu");
await step("P01", "Admin (tenant_admin julian.bui · evolu): nhóm Beta testers đã có 5 thành viên (gồm người duyệt)", async () => {
  await page.goto("http://localhost:3000/groups");
  await expect(page.getByText("Beta testers").first()).toBeVisible();
  await snap(page, "00-prep-groups", true);
  await page.getByText("Beta testers").first().click();
  await page.waitForTimeout(1500);
  await snap(page, "01-prep-beta-testers", true);
});
for (const key of (process.argv[3] ?? "intake-analyst,docs-architect,reviewer,qc,qc-uat").split(",")) {
  await step(`P-${key}`, `Admin → Agents → Grant access @${key} cho nhóm Beta testers`, async () => {
    await page.goto("http://localhost:3000/agents");
    const row = page.getByRole("row").filter({ hasText: new RegExp(`@${key}(?![-\w])`) });
    await row.getByRole("button", { name: /Grant access/ }).click();
    const d = page.getByRole("dialog");
    await d.getByText("Choose groups and people").click();
    await d.getByRole("checkbox", { name: /Beta testers/ }).check();
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole("row").filter({ hasText: new RegExp(`@${key}(?![-\w])`) })).toContainText("Beta testers", { timeout: 10000 });
    if (key === "intake-analyst") await snap(page, "02-prep-grant-intake-analyst");
  });
}
save(); await browser.close();

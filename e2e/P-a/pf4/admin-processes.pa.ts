// ADM-FR-65 · e2e P-a PF4 · E-P15a (test-plan-e2e §2; plan-frontend-e2e §2 admin-web; Import/Export ⇒ P-b, U2): Adm (tenant_admin)
// có `link "Quy trình"` (CHỨC NĂNG); `tab "Của công ty"` / `tab "Mẫu"`; tab Mẫu ⇒ "Chép mẫu" `sdlc` ⇒ dòng mới ở `table
// "Quy trình"` đang tắt; bật (`switch "Bật …"`) ⇒ lỗi "Chọn Group kiểm cho mọi giai đoạn có người kiểm trước khi bật."; member
// không có nav.
import { expect, test } from "@playwright/test";
import { adminLogin, settle } from "../_pa-support";

test.afterEach(() => settle());

test('ADM-FR-65 · E-P15a · Adm: nav "Quy trình"; tab Mẫu ⇒ "Chép mẫu" sdlc ⇒ dòng mới tắt; bật ⇒ lỗi phải chọn Group kiểm; member không có nav', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    const nav = p.getByRole("link", { name: "Quy trình", exact: true });
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(p.getByRole("tab", { name: "Của công ty" })).toBeVisible();
    await p.getByRole("tab", { name: "Mẫu" }).click();
    const tpl = p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: /!sdlc(?!-)/ });
    await expect(tpl).toBeVisible();
    await tpl.getByRole("button", { name: "Chép mẫu" }).click();
    await expect(p.getByText("Đã chép mẫu")).toBeVisible();

    await p.getByRole("tab", { name: "Của công ty" }).click();
    const row = p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: "sdlc" });
    await expect(row).toHaveCount(1);
    const sw = row.getByRole("switch", { name: /^Bật / });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(
      p.getByText("Chọn Group kiểm cho mọi giai đoạn có người kiểm trước khi bật."),
    ).toBeVisible();
    await expect(sw).not.toBeChecked();

    // member (lan) không có nav "Quy trình"
    const m = await browser.newContext();
    const mp = await m.newPage();
    await adminLogin(mp, "A").catch(() => undefined);
    await expect(mp.getByRole("link", { name: "Quy trình", exact: true })).toHaveCount(0);
    await m.close();
  } finally {
    await ctx.close();
  }
});

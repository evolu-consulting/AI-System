// ADM-FR-65 · e2e P-a PF4 · E-P15a (test-plan-e2e §2; plan-frontend-e2e §2 admin-web; Import/Export ⇒ P-b, U2): Adm (tenant_admin)
// có `link "Quy trình"` (CHỨC NĂNG); `một trang Quy trình (không tab); "Tạo quy trình" › mẫu ⇒ "Chép mẫu" `sdlc` ⇒ dòng mới ở `table
// "Quy trình"` đang tắt; bật (`switch "Bật …"`) ⇒ lỗi "Chọn Group kiểm cho mọi giai đoạn có người kiểm trước khi bật."; member
// không có nav.
import { expect, test } from "@playwright/test";
import { adminLogin, settle } from "../_pa-support";

test.afterEach(() => settle());

// CR-121 c13: /processes chỉ còn là Thư viện (hộp "Tạo quy trình" theo công ty `flows-create` đã gỡ) ⇒ cần viết lại theo tab Mẫu · chạy thử, tạm treo.
test.fixme('ADM-FR-65 · E-P15a · Adm: nav "Quy trình"; tab Mẫu ⇒ "Chép mẫu" sdlc ⇒ dòng mới tắt; bật ⇒ lỗi phải chọn Group kiểm; member không có nav', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    const nav = p.getByRole("link", { name: "Quy trình", exact: true });
    await expect(nav).toBeVisible();
    await nav.click();
    // CR-120: MỘT trang "Quy trình" (không còn tab); mẫu nằm trong "Tạo quy trình" › "Tạo từ mẫu".
    await expect(p.getByTestId("flows-list")).toBeVisible();
    await expect(p.getByRole("tab")).toHaveCount(0);
    // cr120-handson-fixes · 4/6: mọi khe tải được (không "Không tải được một phần…") và không lộ mã khe (`community.x ·`).
    await p.waitForLoadState("networkidle");
    await expect(p.getByText("Không tải được một phần quy trình của công ty.")).toHaveCount(0);
    await expect(p.getByTestId("flows-list")).not.toContainText(
      /(community|contracts)\.[a-z-]+\s·/,
    );
    await p.getByTestId("flows-create").click();
    const tpl = p.getByTestId("flows-template-sdlc");
    await expect(tpl).toBeVisible();
    const tplName = (await tpl.getByRole("link").innerText()).trim();
    await tpl.getByRole("button", { name: "Chép mẫu" }).click();
    await expect(p.getByText("Đã chép mẫu")).toBeVisible();

    // bản chép là quy trình "Công ty tạo", mặc định Tắt; chỉ hàng của công ty có công tắc "Bật".
    const row = p
      .getByTestId("flows-list")
      .getByRole("listitem")
      .filter({ hasText: tplName })
      .filter({ has: p.getByRole("switch") });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Công ty tạo")).toBeVisible();
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

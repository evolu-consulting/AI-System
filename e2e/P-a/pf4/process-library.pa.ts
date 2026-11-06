// CR-105 · L3 `pl-editor-ui` · e2e P-a PF4: platform_admin nhân bản "Quy trình HĐ mặc định", sửa ở Form, xuất bản, gán cho tenant acme
// ⇒ cột "Dùng bởi" tăng; Canvas hiện nút hệ thống (contracts-route/contracts-finalize) với huy hiệu "Hệ thống", không xoá được.
// Chỉ chạy được khi backend L1/L2a/L2b đã gộp (seed 0069: def "Quy trình HĐ mặc định" + khe contracts.approval). KHÔNG chạy trong lát.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { seedAdmin } from "../../support/helpers";
import { ACME, ADMIN_URL, settle, withSql } from "../_pa-support";

test.afterEach(() => settle());

async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** F9: Nhân bản/Xoá nằm trong menu ⋯ của dòng (`library-row-menu`). */
async function openMenu(row: Locator): Promise<void> {
  await row.getByTestId("library-row-menu").click();
}
async function pickMenu(row: Locator, name: string): Promise<void> {
  await openMenu(row);
  await row.page().getByRole("menuitem", { name }).click();
}

test("sửa Form, xuất bản, gán tenant, canvas khoá nút hệ thống", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await platformLogin(p);
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();

    // danh sách thư viện: khe "Dùng cho" nằm dưới tên (CR-105 UAT, bảng vừa 1440px) + huy hiệu mặc định; mẫu chạy thử nằm ở tab riêng
    await expect(p.getByRole("tab", { name: "Thư viện" })).toBeVisible();
    await expect(p.getByRole("tab", { name: /Mẫu · chạy thử/ })).toBeVisible();
    const table = p.getByRole("table", { name: "Quy trình" });
    await expect(table.getByRole("columnheader", { name: "Dùng cho" })).toHaveCount(0);
    const base = table.getByRole("row").filter({ hasText: "Quy trình HĐ mặc định" }).first();
    await expect(base.getByText("Mặc định", { exact: true })).toBeVisible();
    await expect(base.getByText("Sổ Hợp Tác · Duyệt hợp đồng")).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "sdlc" })).toHaveCount(0); // mẫu không lẫn

    // giao diện đơn giản: không còn cột Ký hiệu; trạng thái + "đang dùng" bằng chữ; mặc định ghim đầu; nút tạo từ mặc định
    await expect(table.getByRole("columnheader", { name: "Ký hiệu" })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Trạng thái" })).toBeVisible();
    // CR-121 c15: cột "Dùng bởi" nói bằng công ty; mặc định = "Mặc định cho công ty chưa chọn"
    await expect(table.getByRole("columnheader", { name: "Dùng bởi" })).toBeVisible();
    await expect(base.getByText("Mặc định", { exact: true })).toBeVisible(); // F14: viên Mặc định thay câu dài
    // Có nhiều quy trình mặc định của khe (HĐ + 3 khe DLC từ hub 0070) ⇒ chỉ kiểm hàng mặc định HĐ có mặt, không kiểm vị trí đầu.
    await expect(base).toBeVisible();
    await expect(p.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Tạo quy trình" })).toBeVisible();

    // Nhân bản ⇒ hộp thoại nhập TÊN (ký hiệu tự sinh) ⇒ mở nháp mới
    await pickMenu(base, "Nhân bản");
    const cloneDlg = p.getByRole("dialog");
    await expect(cloneDlg.getByRole("textbox", { name: "Tên quy trình mới" })).toHaveValue(
      "Quy trình HĐ mặc định – bản mới",
    );
    await cloneDlg.getByRole("textbox", { name: "Tên quy trình mới" }).fill("Quy trình HĐ e2e");
    await expect(cloneDlg.getByText("Ký hiệu tự sinh: quy-trinh-hd-e2e")).toBeVisible();
    await cloneDlg.getByRole("button", { name: "Nhân bản", exact: true }).click();
    await expect(p.getByText("Đã nhân bản thành bản nháp mới")).toBeVisible();
    const toolbar = p.getByTestId("library-toolbar");
    await expect(toolbar.getByText("Nháp", { exact: true })).toBeVisible();
    const name = (await p.getByRole("heading", { level: 1 }).innerText()).trim();
    // thanh trên: không lỗi i18n; chỉ MỘT công tắc (Sơ đồ / Danh sách); gợi ý "Lưu nháp…" hiện khi chưa xuất bản
    await expect(toolbar).toContainText("0 công ty");
    await expect(toolbar).not.toContainText("returned an object");
    await expect(p.getByRole("tab", { name: "Danh sách" })).toHaveCount(0);
    await expect(toolbar.getByText(/Lưu nháp chưa áp dụng cho tenant/)).toBeVisible();
    expect(name).toBe("Quy trình HĐ e2e");
    // CR-122: flow có Bắt đầu khi chỉ còn MỘT trình sửa canvas (Form theo khe + nút hệ thống đã gỡ) — sửa/xuất bản/hiện nút ở cr122-flows + cr122-editor.
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();

    // Dọn rác: xoá quy trình KHÔNG dùng (nháp hoặc đã xuất bản) bằng gõ lại tên; mặc định / đang gán thì nút Xoá bị khoá
    await openMenu(table.getByRole("row").filter({ hasText: name }).first());
    await expect(p.getByRole("menuitem", { name: "Xoá" })).toBeEnabled(); // chưa công ty nào dùng ⇒ xoá được
    await p.keyboard.press("Escape");
    await openMenu(base);
    await expect(p.getByTestId("delete-locked")).toBeDisabled(); // mặc định của khe: khoá (lý do nằm trong menu)
    await p.keyboard.press("Escape");
    await pickMenu(base, "Nhân bản");
    await p.getByRole("textbox", { name: "Tên quy trình mới" }).fill("Nháp tạm e2e");
    await p.getByRole("dialog").getByRole("button", { name: "Nhân bản", exact: true }).click();
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Nháp tạm e2e");
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    const tmp = table.getByRole("row").filter({ hasText: "Nháp tạm e2e" });
    await pickMenu(tmp, "Xoá");
    // xác nhận bằng cách GÕ LẠI TÊN (nút Xoá chỉ bật khi gõ đúng)
    const confirm = p.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Xoá" })).toBeDisabled();
    await confirm.getByRole("textbox").fill("Nháp tạm e2e");
    await confirm.getByRole("button", { name: "Xoá" }).click();
    await expect(tmp).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

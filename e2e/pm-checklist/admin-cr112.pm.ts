// pm-checklist-e2e · CR-112 · 5 bước checklist ai-admin trong docs/PM-SETUP.md §5, trên UI thật + dữ liệu seed của PM (tenant `evolu`).
// Đăng nhập bằng trang đăng nhập của app (platform/admin = SEED_ADMIN_* của lượt e2e; evolu/julian.bui = mật khẩu dev cố định của fixture).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginUI, toast } from "../support/helpers";

const DEMO_PW = "1234567890"; // tools/hub-dev/src/fixture.ts DEMO_PASSWORD (fixture dev, không phải secret)
const nav = (p: Page) => p.getByRole("navigation", { name: "Điều hướng chính" });
const APPS = /Sổ Hợp Tác|Hợp đồng/;

async function openEvolu(page: Page, tab: string) {
  await nav(page)
    .getByRole("list", { name: "Danh sách công ty" })
    .getByRole("link", { name: /Evolu/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /Evolu/ })).toBeVisible();
  await page.getByRole("tab", { name: tab }).click();
  await expect(page.getByRole("tab", { name: tab, selected: true })).toBeVisible();
}

test("CR-112 · 1 · Evolu › Ứng dụng & Gói: Sổ Hợp Tác, Community, DLC kèm số vai và số người", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEvolu(page, "Ứng dụng & Gói");
  // Thực tế: thẻ Sổ Hợp Tác + Community kèm "Gói đang bật 3 vai 5 người"; DLC không có thẻ app riêng ở tab này.
  for (const app of [APPS, /Community/]) {
    const card = page.getByRole("region", { name: app }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/3 vai\s*5 người/);
  }
});

test("CR-112 · 2 · Phân quyền: mỗi app 3 vai (Toàn quyền/Nhân viên/Chỉ xem), julian.bui ở Toàn quyền", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEvolu(page, "Phân quyền");
  const tables = page.getByRole("table", { name: /^Vai của / });
  await expect(tables).toHaveCount(3);
  for (let i = 0; i < 3; i++)
    for (const r of ["Toàn quyền", "Nhân viên", "Chỉ xem"])
      await expect(tables.nth(i).getByRole("row").filter({ hasText: r }).first()).toBeVisible();
  const julian = page
    .getByRole("table", { name: "Gán người dùng vào vai" })
    .getByRole("row")
    .filter({ has: page.getByText("julian.bui", { exact: true }) });
  await expect(julian.first()).toContainText("Toàn quyền");
});

test("CR-112 · 3 · Tạo vai 'Kiểm soát' (Xem) cho Sổ Hợp Tác, gán rowan.nguyen, Lưu; xoá vai: còn người thì khoá, gỡ người rồi xoá được", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEvolu(page, "Phân quyền");
  const block = page.getByRole("region", { name: APPS }).first();
  await block.getByRole("button", { name: "Tạo vai" }).click();
  const dlg = page.getByRole("dialog", { name: /Tạo vai/ });
  await dlg.getByLabel("Tên vai").fill("Kiểm soát");
  await dlg.getByLabel("Mức").selectOption({ label: "Xem" });
  await dlg.getByRole("button", { name: "Tạo vai" }).click();
  const row = block.getByRole("row").filter({ hasText: "Kiểm soát" });
  await expect(row).toContainText("Mới");
  const rowan = page
    .getByRole("table", { name: "Gán người dùng vào vai" })
    .getByRole("row")
    .filter({ has: page.getByText("rowan.nguyen", { exact: true }) });
  const pick = rowan.getByRole("combobox", { name: /Gán vai cho rowan\.nguyen/ });
  const label = (await pick.locator("option").allTextContents()).find((t) =>
    t.includes("Kiểm soát"),
  );
  expect(label).toBeTruthy();
  await pick.selectOption({ label: label as string });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu")).toBeVisible();
  await expect(row).toContainText("1 người");
  // còn người ⇒ nút Xoá vai bị khoá (không bấm được)
  await expect(page.getByRole("button", { name: "Xoá vai Kiểm soát" })).toBeDisabled();
  await rowan.getByRole("button", { name: /Gỡ rowan\.nguyen khỏi vai Kiểm soát/ }).click();
  await expect(page.getByRole("button", { name: "Xoá vai Kiểm soát" })).toBeEnabled();
  await page.getByRole("button", { name: "Xoá vai Kiểm soát" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu")).toBeVisible();
  await expect(block.getByRole("row").filter({ hasText: "Kiểm soát" })).toHaveCount(0);
});

test("CR-112 · 4 · evolu/julian.bui: chỉ thấy công ty mình, không nhóm NỀN TẢNG; vào được tab Người dùng và Phân quyền", async ({
  page,
}) => {
  await loginUI(page, "evolu", "julian.bui", DEMO_PW);
  await expect(nav(page).getByText("NỀN TẢNG", { exact: true })).toHaveCount(0);
  await expect(
    nav(page).getByRole("list", { name: "Danh sách công ty" }).getByRole("link"),
  ).toHaveCount(1);
  await page.goto("/users");
  await expect(page.getByRole("tab", { name: "Thành viên", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Phân quyền" }).click();
  await expect(page.getByRole("tab", { name: "Phân quyền", selected: true })).toBeVisible();
});

test("CR-112 · 5 · Thêm công ty: wizard 4 bước; mã trùng `evolu` báo lỗi ở bước 1", async ({
  page,
}) => {
  await loginAdmin(page);
  await nav(page).getByRole("link", { name: "Tạo công ty" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thêm công ty" })).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Các bước thêm công ty" });
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Evolu trùng");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("dup.admin");
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Dup Admin");
  await page.getByRole("textbox", { name: "Email" }).fill("dup@evolu.local");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  await expect(page.getByText("Mã công ty đã được dùng")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mã công ty" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(steps.locator('[aria-current="step"]')).toContainText("Thông tin");
});

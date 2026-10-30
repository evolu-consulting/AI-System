// CR-104 · ops-ui · e2e `/system` "Tình trạng hệ thống" (Hub thật, vòng nền tắt `HUB_OPS_WATCH=off`, kiểm bằng "Kiểm tra ngay").
import { expect, type Page, test } from "@playwright/test";
import { PW } from "../../tests/acceptance/M1/_data";
import { loginAdmin, loginToShell } from "../support/helpers";

const NAV = "Tình trạng hệ thống";
const h1 = (p: Page) => p.getByRole("heading", { level: 1, name: NAV });

test('platform_admin: 8 thẻ check, bấm "Kiểm tra ngay" cập nhật lúc kiểm, bấm lại trong 1 phút thì đếm ngược', async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByRole("link", { name: NAV }).click();
  await expect(h1(page)).toBeVisible();
  await expect(page).toHaveURL(/\/system$/);

  for (const label of [
    "Provider AI",
    "Run AI thất bại",
    "DB / Redis",
    "Host công khai",
    "Chứng chỉ TLS",
    "Backup",
    "Đĩa server",
    "Hàng đợi / run kẹt",
  ])
    await expect(page.getByRole("article", { name: label })).toBeVisible();

  // chưa có lượt kiểm nào (vòng nền tắt): thẻ "Chưa rõ", chưa có lúc kiểm
  const db = page.getByTestId("check-db_redis");
  await expect(db).toHaveAttribute("data-status", "unknown");
  await expect(page.getByTestId("checked-at-db_redis")).toHaveCount(0);

  await page.getByRole("button", { name: "Kiểm tra ngay" }).click();
  const checked = page.getByTestId("checked-at-db_redis");
  await expect(checked).toBeVisible();
  await expect(db).not.toHaveAttribute("data-status", "unknown");
  expect(Date.parse((await checked.getAttribute("datetime")) ?? "")).toBeGreaterThan(
    Date.now() - 120_000,
  );
  await expect(page.getByTestId("sys-summary")).toBeVisible();

  // bấm lại < 1 phút ⇒ Hub 429 ⇒ nút khoá + đếm ngược
  await page.getByRole("button", { name: "Kiểm tra ngay" }).click();
  await expect(page.getByRole("button", { name: /Chờ \d+ giây/ })).toBeDisabled();

  // Gói chẩn đoán: tải .txt có đủ nội dung, không gọi mạng thêm
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Gói chẩn đoán" }).click();
  const file = await (await dl).path();
  const text = (await import("node:fs")).readFileSync(file, "utf8");
  expect(text).toContain("GÓI CHẨN ĐOÁN");
  expect(text).toContain("DB / Redis");
  expect(text).toContain("Thời điểm");
});

test("cấu hình: đổi tần suất → Lưu → tải lại vẫn giữ; ngưỡng sai báo lỗi và không cho lưu", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/system");
  await expect(h1(page)).toBeVisible();

  const every = page.getByRole("spinbutton", { name: "Tần suất kiểm", exact: true });
  const save = page.getByRole("button", { name: "Lưu", exact: true });
  await expect(every).toHaveValue("30");
  await expect(save).toBeDisabled();

  // sai: tần suất ngoài 5–1440
  await every.fill("3");
  await expect(page.getByText("Phải trong khoảng 5–1440")).toBeVisible();
  await expect(save).toBeDisabled();

  // sai: warn >= crit của Đĩa server
  await every.fill("45");
  const warn = page.getByRole("spinbutton", { name: "Đĩa server Ngưỡng cảnh báo" });
  const crit = page.getByRole("spinbutton", { name: "Đĩa server Ngưỡng nghiêm trọng" });
  await warn.fill("95");
  await crit.fill("90");
  await expect(page.getByText("Ngưỡng cảnh báo phải nhỏ hơn ngưỡng nghiêm trọng")).toBeVisible();
  await expect(save).toBeDisabled();

  // đúng: lưu
  await warn.fill("70");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Đã lưu cấu hình")).toBeVisible();

  await page.reload();
  await expect(every).toHaveValue("45");
  await expect(warn).toHaveValue("70");
  await expect(crit).toHaveValue("90");
  // lịch sử ghi "Đổi cấu hình bởi …"
  await expect(page.getByRole("cell", { name: /Đổi cấu hình bởi/ }).first()).toBeVisible();

  // Khôi phục mặc định chỉ điền form, chưa lưu
  await page.getByRole("button", { name: "Khôi phục mặc định" }).click();
  await expect(every).toHaveValue("30");
  await expect(warn).toHaveValue("80");
  await page.reload();
  await expect(every).toHaveValue("45");
});

test("tắt một check: thẻ xám 'Đã tắt'", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/system");
  await page.getByRole("switch", { name: "Bật check Backup" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Đã lưu cấu hình")).toBeVisible();
  const card = page.getByTestId("check-backup");
  await expect(card).toHaveAttribute("data-status", "disabled");
  await expect(card.getByText("Đã tắt")).toBeVisible();
});

test("tenant_admin: không có mục menu, vào /system bị chặn", async ({ page }) => {
  await loginToShell(page, "acme", "binh", PW);
  await expect(page.getByRole("link", { name: NAV })).toHaveCount(0);
  await page.goto("/system");
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

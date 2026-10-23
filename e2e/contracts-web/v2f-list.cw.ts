// V2-F · HD-03 · Luật 4b: danh sách hợp đồng v2 — nút «Thêm thủ công» + «Upload hợp đồng», cột Hợp đồng/Đối tác/Loại/Giá trị/Hiệu lực/Giai đoạn
// (+ bước hiện tại, đỏ khi quá hạn)/Thao tác, bấm hàng mở HĐ, «Xem»; «Xoá» ẩn tới V2-M. Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { listAsHub, ROWS } from "./dataset-list";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const first = ROWS[0];

test("chỉ nút Upload (không còn Thêm thủ công) + cột theo mockup; không có nút Xoá", async ({
  page,
}) => {
  await installV2f(page);
  await page.goto("/contracts");
  await expect(page.getByRole("link", { name: "Thêm thủ công" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload hợp đồng" })).toBeVisible();
  const heads = page.locator("main thead th");
  await expect(heads).toHaveText([
    "Hợp đồng",
    "Đối tác",
    "Loại",
    "Giá trị",
    "Hiệu lực",
    "Giai đoạn",
    "Thao tác",
  ]);
  await expect(page.getByRole("button", { name: /^Xoá/ })).toHaveCount(0);
  await expect(page.getByTitle("Xoá")).toHaveCount(0);
});

test("hàng: tên + số, đối tác theo loại (Mua ⇒ bên bán), loại, giá trị, hiệu lực, giai đoạn + bước hiện tại đỏ khi quá hạn", async ({
  page,
}) => {
  await installV2f(page);
  await page.goto("/contracts");
  const row = page.locator("main tbody tr", { hasText: first?.title });
  await expect(row.locator("td").nth(0)).toContainText("01/2026/HĐMB-PN");
  await expect(row.locator("td").nth(1)).toHaveText("Bao Bì Phương Nam");
  await expect(row.locator("td").nth(2)).toHaveText("Mua");
  await expect(row.locator("td").nth(3)).toHaveText("245.000.000 đ");
  await expect(row.locator("td").nth(4)).toContainText("01/01/2026");
  await expect(row.locator("td").nth(4)).toContainText("đến 31/12/2026");
  const stage = row.locator("td").nth(5);
  await expect(stage.getByText("Quá hạn", { exact: true })).toBeVisible();
  await expect(stage.getByText("Giao đợt 2")).toHaveClass(/text-late/);
  const waiting = page
    .locator("main tbody tr", { hasText: "Hợp đồng cung cấp gia vị" })
    .locator("td")
    .nth(5);
  await expect(waiting).toHaveText("Chờ xác nhận");
  const done = page
    .locator("main tbody tr", { hasText: "Hợp đồng vận chuyển quý 4" })
    .locator("td")
    .nth(5);
  await expect(done).toHaveText("Đã xong");
});

test("yêu cầu danh sách kèm include=progress", async ({ page }) => {
  await installV2f(page);
  const reqs: URLSearchParams[] = [];
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      reqs.push(new URL(r.request().url()).searchParams);
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(listAsHub()),
      });
    },
  );
  await page.goto("/contracts");
  await expect(page.getByText(first?.title ?? "").first()).toBeVisible();
  expect(reqs[0]?.get("include")).toBe("progress");
});

test("bấm hàng hoặc «Xem» mở hợp đồng", async ({ page }) => {
  await installV2f(page);
  await page.goto("/contracts");
  await page.locator("main tbody tr", { hasText: first?.title }).locator("td").nth(3).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${first?.id}$`));
  await page.goBack();
  await page
    .locator("main tbody tr", { hasText: "Hợp đồng vận chuyển quý 4" })
    .getByRole("link", { name: /^Xem/ })
    .click();
  await expect(page).toHaveURL(/\/contracts\/c1000000-0000-4000-8000-000000000013$/);
});

test("«Upload hợp đồng» chọn file ⇒ POST multipart rồi mở HĐ vừa tải", async ({ page }) => {
  await installV2f(page);
  let uploaded = false;
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      if (r.request().method() === "POST") {
        uploaded = true;
        return r.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            id: "c1000000-0000-4000-8000-0000000000b2",
            status: "extracting",
            version: 1,
          }),
        });
      }
      return r.fallback();
    },
  );
  await page.goto("/contracts");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload hợp đồng" }).click();
  await (await chooser).setFiles({
    name: "hd.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page).toHaveURL(/\/contracts\/c1000000-0000-4000-8000-0000000000b2$/);
  expect(uploaded).toBe(true);
});

test("viewer: không có nút thêm", async ({ page }) => {
  await installV2f(page, { role: "viewer" });
  await page.goto("/contracts");
  await expect(page.getByText(first?.title ?? "").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Thêm thủ công" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload hợp đồng" })).toHaveCount(0);
});

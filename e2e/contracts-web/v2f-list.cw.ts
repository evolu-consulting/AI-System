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
  await page.goto("/contracts/list");
  await expect(page.getByRole("link", { name: "Thêm thủ công" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tải hợp đồng lên" })).toBeVisible();
  const heads = page.locator("main thead th");
  // CR-128 (b/c): cột «Hợp đồng» tách «Tên» + «Số HĐ».
  await expect(heads).toHaveText([
    "Tên",
    "Số HĐ",
    "Đối tác",
    "Loại",
    "Giá trị",
    "Hiệu lực",
    "Trạng thái",
    "Đang chờ",
    "Thao tác",
  ]);
  await expect(page.getByRole("button", { name: /^Xoá/ })).toHaveCount(0);
  await expect(page.getByTitle("Xoá")).toHaveCount(0);
});

test("hàng: tên + số, đối tác theo loại (Mua ⇒ bên bán), loại, giá trị, hiệu lực, trạng thái + hiệu lực, đang chờ", async ({
  page,
}) => {
  await installV2f(page);
  await page.goto("/contracts/list");
  const row = page.locator("main tbody tr", { hasText: first?.title });
  await expect(row.locator("td").nth(0)).toContainText(first?.title ?? ""); // CR-128: «Tên» riêng, «Số HĐ» là cột kế
  await expect(row.locator("td").nth(1)).toContainText("01/2026/HĐMB-PN");
  await expect(row.locator("td").nth(2)).toHaveText("Bao Bì Phương Nam");
  await expect(row.locator("td").nth(3)).toHaveText("Mua");
  await expect(row.locator("td").nth(4)).toHaveText("245.000.000 đ");
  await expect(row.locator("td").nth(5)).toContainText("01/01/2026");
  await expect(row.locator("td").nth(5)).toContainText("đến 31/12/2026");
  // CR-127 Q10b: cột «Trạng thái» (4 trạng thái mới + hiệu lực) và «Đang chờ» (ai đang giữ bước) thay cột «Bước» của máy cũ.
  const cellOf = (title: string, n: number) =>
    page.locator("main tbody tr", { hasText: title }).locator("td").nth(n);
  await expect(row.locator("td").nth(6)).toHaveText("Đã duyệt xongCòn hiệu lực");
  await expect(cellOf("Hợp đồng cung cấp gia vị", 6)).toHaveText("Nháp");
  await expect(cellOf("Hợp đồng vận chuyển quý 4", 6)).toContainText("Hết hạn sau 33 ngày");
  await expect(row.locator("td").nth(7)).toHaveText("—");
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
  await page.goto("/contracts/list");
  await expect(page.getByText(first?.title ?? "").first()).toBeVisible();
  expect(reqs[0]?.get("include")).toBe("progress");
});

test("bấm hàng hoặc «Xem» mở hợp đồng", async ({ page }) => {
  await installV2f(page);
  await page.goto("/contracts/list");
  await page.locator("main tbody tr", { hasText: first?.title }).locator("td").nth(3).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${first?.id}$`));
  await page.goBack();
  await page
    .locator("main tbody tr", { hasText: "Hợp đồng vận chuyển quý 4" })
    .getByRole("link", { name: /^Xem/ })
    .click();
  await expect(page).toHaveURL(/\/contracts\/c\/c1000000-0000-4000-8000-000000000013$/);
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
  await page.goto("/contracts/list");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Tải hợp đồng lên" }).click();
  await (await chooser).setFiles({
    name: "hd.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await page.getByTestId("upload-confirm").click(); // DOC-ui-gaps: chọn loại chứng từ (mặc định HĐ kinh tế)
  await expect(page).toHaveURL(/\/contracts\/c\/c1000000-0000-4000-8000-0000000000b2$/);
  expect(uploaded).toBe(true);
});

test("viewer: không có nút thêm", async ({ page }) => {
  await installV2f(page, { role: "viewer" });
  await page.goto("/contracts/list");
  await expect(page.getByText(first?.title ?? "").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Thêm thủ công" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tải hợp đồng lên" })).toHaveCount(0);
});

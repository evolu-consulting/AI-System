// CHAT-AC-19..23, UC-07 · danh sách, mở, đổi tên, xoá, tìm (test-plan §6 E-V1…V6).
import { expect, test } from "@playwright/test";
import { flows, login, openConversation, resetMock } from "./_support";

const EMAIL = "Soạn email báo giá Minh Phát";
const INVOICE = "Hoá đơn tháng 9 cần đối chiếu";
const ROW_LINKS = 'nav a[href^="/c/"]:not([href="/c/new"])';

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

test("CHAT-AC-19 · sidebar chia nhóm thời gian, mỗi nhóm đúng hội thoại seed [E-V1]", async ({
  page,
}) => {
  await expect(page.getByRole("link", { name: EMAIL, exact: true })).toBeVisible();
  const groups = await page.getByRole("navigation", { name: "Hội thoại" }).evaluate((nav) => {
    const out: Record<string, string[]> = {};
    let cur = "";
    for (const el of nav.querySelectorAll('h2, a[href^="/c/"]')) {
      if (el.tagName === "H2") {
        cur = (el.textContent ?? "").trim();
        out[cur] = [];
      } else if (el.getAttribute("href") !== "/c/new" && cur) {
        out[cur]?.push((el.textContent ?? "").trim());
      }
    }
    return out;
  });
  expect(groups["Hôm nay"]).toEqual([EMAIL]);
  expect(groups["7 ngày qua"]).toEqual([INVOICE]);
  expect(groups["30 ngày qua"]).toEqual(["Tóm tắt họp giao ban"]);
  expect(groups["Cũ hơn"]).toEqual(["Kế hoạch marketing Q3"]);
});

test("CHAT-AC-20 · mở hội thoại: 2 article theo thứ tự flow, link aria-current [E-V2]", async ({
  page,
}) => {
  await openConversation(page, EMAIL);
  await expect(flows(page)).toHaveCount(2);
  await expect(page.getByRole("link", { name: EMAIL, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("CHAT-AC-21 · đổi tên qua menu ⋯: PATCH 200, link và tiêu đề trang theo tên mới [E-V3]", async ({
  page,
}) => {
  await openConversation(page, EMAIL);
  const row = page
    .getByRole("navigation", { name: "Hội thoại" })
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", { name: EMAIL, exact: true }),
    });
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Đổi tên" }).click();
  const dlg = page.getByRole("dialog", { name: "Đổi tên hội thoại" });
  await dlg.getByRole("textbox", { name: "Tên hội thoại" }).fill("Báo giá Minh Phát v2");
  const patch = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && /\/conversations\/[^/]+$/.test(new URL(r.url()).pathname),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await patch).status()).toBe(200);
  await expect(page.getByRole("link", { name: "Báo giá Minh Phát v2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Báo giá Minh Phát v2" })).toBeVisible();
});

test("CHAT-AC-22 · xoá: Huỷ giữ nguyên; xác nhận DELETE 204, link biến mất, về /c/new [E-V4]", async ({
  page,
}) => {
  await openConversation(page, EMAIL);
  const row = page
    .getByRole("navigation", { name: "Hội thoại" })
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", { name: EMAIL, exact: true }),
    });
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Xoá" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Xoá hội thoại?" });
  await confirm.getByRole("button", { name: "Huỷ" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("link", { name: EMAIL, exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Xoá" }).click();
  const del = page.waitForResponse((r) => r.request().method() === "DELETE");
  await page
    .getByRole("alertdialog", { name: "Xoá hội thoại?" })
    .getByRole("button", { name: "Xoá" })
    .click();
  expect((await del).status()).toBe(204);
  await expect(page.getByRole("link", { name: EMAIL, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/c\/new$/);
});

test("CHAT-AC-23 · tìm 'hoa don' (không dấu) chỉ còn hội thoại hoá đơn; 'xyz' không còn gì [E-V5]", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Tìm hội thoại" });
  await search.fill("hoa don");
  await expect(page.locator(ROW_LINKS)).toHaveCount(1);
  await expect(page.getByRole("link", { name: INVOICE, exact: true })).toBeVisible();
  await search.fill("xyz");
  await expect(page.locator(ROW_LINKS)).toHaveCount(0);
});

test("UC-07 · hội thoại lạ hiện 'Hội thoại không tồn tại' và đường về trang chào [E-V6]", async ({
  page,
}) => {
  await page.goto("/c/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("Hội thoại không tồn tại")).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "Về trang chào" })
      .or(page.getByRole("button", { name: "Về trang chào" })),
  ).toBeVisible();
});

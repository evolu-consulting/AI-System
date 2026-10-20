// Luồng 2 · từng trang contracts-web theo mockup nav (Tổng quan, Hợp đồng, Đối tác, Sản phẩm & Giá, Cần xử lý, Cài đặt):
// tải được, có dữ liệu demo, không lỗi console, thao tác chính chạy. Bản ghi tạo ra gắn tiền tố E2E-DEPLOY và được dọn cuối cùng.
import type { Page } from "@playwright/test";
import {
  bodyText,
  CW,
  type Errs,
  expect,
  login,
  settle,
  TAG,
  test,
  watchConsole,
} from "./_support";

let page: Page;
let errs: Errs;
const RAW_KEY = /\bcontracts\.[a-z]+(\.[a-zA-Z]+)+\b/;

async function go(path: string): Promise<void> {
  errs.list.length = 0;
  await page.goto(CW + path);
  await settle(page);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  page = await ctx.newPage();
  await login(page, CW);
  errs = watchConsole(page);
  await settle(page);
});
test.afterAll(async () => {
  await page.context().close();
});

test.describe("02 contracts-web", () => {
  test("Tổng quan: khối Cần xử lý + Hợp đồng + Đối tác cần xem lại có dữ liệu", async () => {
    await go("/overview");
    for (const h of ["Tổng quan", "Cần xử lý", "Hợp đồng", "Đối tác cần xem lại"])
      await expect(page.getByRole("heading", { name: h }).first()).toBeVisible();
    expect(await bodyText(page)).toMatch(/\d+ việc/);
    await expect(page.locator("main a[href^='/contracts/']").first()).toBeVisible();
    expect(errs.list).toEqual([]);
  });

  test("Tổng quan: 'Xem tất cả hợp đồng' sang danh sách hợp đồng", async () => {
    await go("/overview");
    await page.getByRole("link", { name: /Xem tất cả hợp đồng/ }).click();
    await expect(page).toHaveURL(/\/contracts$/);
  });

  test("Cần xử lý (khối trong Tổng quan): có việc, hành động chọn kết quả hiện, không đổi dữ liệu", async () => {
    await go("/overview");
    expect(await bodyText(page)).toMatch(/quá hạn|Trễ \d+ ngày/);
    await expect(page.getByRole("button", { name: /Hẹn nhắc/ }).first()).toBeVisible();
    expect(errs.list).toEqual([]);
  });

  test("Hợp đồng: danh sách có dòng, tìm kiếm thu hẹp, mở Lọc", async () => {
    await go("/contracts");
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThan(5);
    expect(await bodyText(page)).toMatch(/\d+ kết quả/);
    await page.getByPlaceholder(/Tìm/).first().fill("Minh Phát");
    await expect.poll(async () => rows.count()).toBeLessThan(total);
    await expect(rows.first()).toContainText(/Minh.Ph/i);
    await page.getByRole("button", { name: "Lọc" }).click();
    expect(await bodyText(page)).toMatch(/Trạng thái|Giai đoạn|Mua/);
    expect(errs.list).toEqual([]);
  });

  test("Hợp đồng: mở chi tiết một hợp đồng (thông tin + sản phẩm + dòng thời gian)", async () => {
    await go("/contracts");
    await page.locator("table tbody tr").first().getByRole("link", { name: "Xem" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}/);
    for (const h of ["Thông tin hợp đồng", "Sản phẩm"])
      await expect(page.getByRole("heading", { name: h })).toBeVisible();
    expect(errs.list).toEqual([]);
  });

  test("Hợp đồng: form Thêm thủ công — bắt buộc điền, KHÔNG lưu (app chưa có xoá hợp đồng)", async () => {
    await go("/contracts");
    await page.getByRole("link", { name: "Thêm thủ công" }).click();
    await expect(page).toHaveURL(/\/contracts\/new/);
    await page.locator("input[name=title]").fill(`${TAG} hợp đồng thử (không lưu)`);
    await expect(page.getByRole("button", { name: "Lưu hợp đồng" })).toBeVisible();
    await page
      .getByRole("button", { name: "Huỷ" })
      .or(page.getByRole("link", { name: "Huỷ" }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/contracts$/);
  });

  // TODO(chưa xây): tạo hợp đồng E2E-DEPLOY rồi dọn — contracts-web/hub chưa có thao tác Xoá hợp đồng, nên test không tạo bản ghi không dọn được.
  test.fixme("Hợp đồng: tạo + sửa + xoá hợp đồng E2E-DEPLOY", async () => {});

  test("Đối tác: danh sách điểm uy tín có dữ liệu, mở chi tiết", async () => {
    await go("/partners");
    await expect(page.getByRole("heading", { name: "Đối tác" })).toBeVisible();
    expect(await bodyText(page)).toMatch(/\d+ kết quả/);
    expect(await bodyText(page)).toMatch(/Hưng Thịnh|Hưng Phát|Bình An/);
    expect(errs.list).toEqual([]);
  });

  // TODO(chưa triển khai): trang chi tiết đối tác V2-I (`/partners?party=…`, 3 tab) có trong code nhưng bản sohoptac2 hiện chạy (build 2026-10-20 17:22) chưa có — bấm tên đối tác không mở gì. Bật lại sau khi deploy V2-I.
  test.fixme("Đối tác: bấm tên mở chi tiết (3 tab Tổng quan · Hợp đồng · Đánh giá & ghi chú)", async () => {
    await go("/partners");
    await page.getByText("Thực phẩm Hưng Phát").first().click();
    await expect(page).toHaveURL(/party=/);
    await expect(page.getByRole("tab", { name: /Đánh giá/ })).toBeVisible();
  });

  test("Sản phẩm & Giá: danh sách sản phẩm có dữ liệu (sau khi nạp bộ mẫu v2)", async () => {
    await go("/products");
    await expect(page.getByRole("heading", { name: "Sản phẩm & Giá" })).toBeVisible();
    expect(await bodyText(page)).not.toMatch(/Chưa có sản phẩm/);
    expect(await bodyText(page)).toMatch(/Chữ ký số|Băng keo|Thùng phi/);
    expect(errs.list).toEqual([]);
  });

  test("Tuyến cũ (/prices /cks /sourcing /settings /settings/scoring) chuyển hướng, không 404", async () => {
    for (const [from, to] of [
      ["/prices", /\/products$/],
      ["/cks", /\/products$/],
      ["/sourcing", /\/products$/],
      ["/settings", /\/settings\/members$/],
      ["/settings/scoring", /\/partners$/],
    ] as const) {
      await go(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("Cài đặt: không lộ khoá i18n thô (contracts.xxx.yyy) ở các trang chính", async () => {
    const bad: string[] = [];
    for (const p of ["/overview", "/contracts", "/partners", "/products", "/settings/members"]) {
      await go(p);
      const m = (await bodyText(page)).match(RAW_KEY);
      if (m) bad.push(`${p}: ${m[0]}`);
    }
    expect(bad, "khoá i18n chưa dịch hiện ra giao diện (lỗi ứng dụng)").toEqual([]);
  });

  test("Cài đặt mở dạng hộp thoại từ menu tài khoản", async () => {
    await go("/overview");
    await page.getByRole("button", { name: "Tài khoản" }).first().click();
    await page.getByRole("menuitem", { name: "Cài đặt", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Cài đặt › Thành viên & phòng ban: tạo phòng ban E2E-DEPLOY, rồi xoá (dọn)", async () => {
    await go("/settings/members");
    const stamp = Date.now().toString(36);
    const title = `${TAG} ${stamp}`;
    const form = page.locator("form").filter({ hasText: "Phòng ban mới" });
    const inputs = form.locator("input");
    await inputs.nth(0).fill(title);
    await inputs.nth(1).fill(`e2e-deploy-${stamp}`);
    await form.getByRole("button", { name: /Tạo phòng ban|Tạo/ }).click();
    const card = page.locator("article").filter({ hasText: title });
    try {
      await expect(card).toBeVisible();
    } finally {
      // Dọn dù có lỗi: xoá mọi phòng ban gắn thẻ E2E-DEPLOY (kể cả sót từ lần chạy trước).
      for (let i = 0; i < 10; i++) {
        const left = page.locator("article").filter({ hasText: TAG });
        const n = await left.count();
        if (n === 0) break;
        await left
          .first()
          .getByRole("button", { name: "Bỏ phòng ban" })
          .click({ timeout: 30_000 })
          .catch(() => {});
        await expect(left)
          .toHaveCount(n - 1, { timeout: 30_000 })
          .catch(() => {});
      }
    }
    await expect(page.locator("article").filter({ hasText: TAG })).toHaveCount(0);
    expect(errs.list).toEqual([]);
  });
});

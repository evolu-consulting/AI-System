// Luồng 2 · từng trang contracts-web theo mockup nav (Tổng quan, Hợp đồng, Đối tác, Sản phẩm & Giá, Cần xử lý, Cài đặt):
// tải được, có dữ liệu demo, không lỗi console, thao tác chính chạy. Bản ghi tạo ra gắn tiền tố E2E-DEPLOY và được dọn cuối cùng.
import type { Page } from "@playwright/test";
import {
  bodyText,
  CHAT,
  CW,
  type Errs,
  expect,
  login,
  settle,
  sweepTaggedGroups,
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
  // Quét cuối: Group E2E-DEPLOY còn sót (Bỏ phòng ban chỉ bỏ dấu, Group giữ nguyên — M1D) xoá qua API.
  await sweepTaggedGroups();
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
    // Có việc (quá hạn hoặc sắp tới hạn) — dữ liệu demo trôi theo ngày / PM bấm Bỏ qua nên không bắt buộc phải có việc quá hạn.
    expect(await bodyText(page)).toMatch(/quá hạn|Trễ \d+ ngày|còn \d+ ngày/);
    // V2-N: mỗi việc chỉ còn nút Bỏ qua (hoặc Đã xong cho "Liên hệ mời gia hạn"); Hẹn nhắc nằm ở trang Việc của tôi cũ.
    await expect(
      page.getByRole("button", { name: /^(Bỏ qua việc này|Đánh dấu đã xong)$/ }).first(),
    ).toBeVisible();
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

  // CR-097 K1/K3a: HĐ chỉ từ văn bản đã ký (không còn "Thêm thủ công"); HĐ đã xác nhận bị khoá. Không ghi dữ liệu.
  test("Hợp đồng: không còn Thêm thủ công; /contracts/new chỉ cho tải lên văn bản", async () => {
    await go("/contracts");
    await expect(page.getByText("Thêm thủ công")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Upload hợp đồng/ }).first()).toBeVisible();
    await go("/contracts/new");
    expect(await bodyText(page)).toContain("Hợp đồng phải tải lên từ văn bản đã ký");
    await expect(page.locator("input[name=title]")).toHaveCount(0);
    expect(errs.list).toEqual([]);
  });

  test("Hợp đồng đã xác nhận: banner khoá, ô pháp lý chỉ đọc, có Tải bản cập nhật + Mở lại (chủ sở hữu)", async () => {
    await go("/contracts");
    await page
      .locator("table tbody tr")
      .filter({ has: page.getByTestId("row-lock") })
      .first()
      .getByRole("link", { name: /Xem/ })
      .click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("banner-locked")).toContainText("Đã xác nhận — đã khoá");
    await expect(page.locator("input[name=number]")).toBeDisabled();
    await expect(page.getByTestId("update-version")).toBeVisible();
    await expect(page.getByText("Mở lại để sửa lỗi trích xuất")).toBeVisible();
    expect(errs.list).toEqual([]);
  });

  test("Đối tác: danh sách điểm uy tín có dữ liệu, mở chi tiết", async () => {
    await go("/partners");
    await expect(page.getByRole("heading", { name: "Đối tác" })).toBeVisible();
    expect(await bodyText(page)).toMatch(/\d+ kết quả/);
    expect(await bodyText(page)).toMatch(/Hưng Thịnh|Hưng Phát|Bình An/);
    expect(errs.list).toEqual([]);
  });

  test("Đối tác: bấm tên mở chi tiết, 3 tab Tổng quan · Hợp đồng · Đánh giá & ghi chú", async () => {
    await go("/partners");
    await page.getByRole("link", { name: "Hưng Thịnh" }).first().click();
    await expect(page).toHaveURL(/party=/);
    const tabs = page.getByRole("tablist", { name: "Thông tin đối tác" });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await expect(tabs.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: /^Hợp đồng · \d+$/ }).click();
    await expect(page).toHaveURL(/tab=contracts/);
    await expect(page.locator("main a[href^='/contracts/']").first()).toBeVisible();
    await tabs.getByRole("tab", { name: /Đánh giá/ }).click();
    await expect(page).toHaveURL(/tab=review/);
    await expect(tabs.getByRole("tab", { name: /Đánh giá/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(errs.list).toEqual([]);
  });

  test("Đối tác: đầu trang chi tiết hiện điện thoại + liên hệ (bộ mẫu v2) và sửa được", async () => {
    await go("/partners");
    await page.getByRole("link", { name: "Hưng Thịnh" }).first().click();
    await expect(page).toHaveURL(/party=/);
    const lead = page.locator("main").getByText(/MST/).first();
    await expect(lead).toContainText("MST");
    // Bộ mẫu v2 (seed-demo-v2) cho Hưng Thịnh: điện thoại + người liên hệ — phải có đúng giá trị đã nạp; sửa xong trả lại như cũ.
    await expect(lead).toContainText("028 3910 2222");
    await expect(lead).toContainText("Phạm Hưng");
    const form = page.getByRole("form", { name: "Điện thoại và người liên hệ" });
    // Sửa số điện thoại của người liên hệ đầu tiên (nhãn ô: "Điện thoại 1"); luôn trả lại giá trị cũ, kể cả khi kiểm giữa chừng lỗi.
    const setPhone = async (v: string) => {
      await page.getByRole("button", { name: "Sửa", exact: true }).click();
      await form.getByLabel("Điện thoại 1", { exact: true }).fill(v);
      await form.getByRole("button", { name: "Lưu" }).click();
      await expect(form).toBeHidden();
    };
    try {
      await setPhone("028 3910 9999");
      await expect(lead).toContainText("028 3910 9999");
    } finally {
      await setPhone("028 3910 2222");
    }
    await expect(lead).not.toContainText("028 3910 9999");
    await expect(lead).toContainText("028 3910 2222");
    expect(errs.list).toEqual([]);
  });

  test("Đối tác: dải 'Uy tín của mình' (C10) trên danh sách", async () => {
    await go("/partners");
    const box = page.getByRole("region", { name: "Uy tín của mình" });
    await expect(box).toBeVisible();
    await expect(box).toContainText(/việc của mình/);
    expect(await bodyText(page)).not.toMatch(RAW_KEY);
    expect(errs.list).toEqual([]);
  });

  test("Nút Ứng dụng: về Chat AI không đăng nhập lại", async () => {
    await go("/overview");
    await page.getByRole("button", { name: "Ứng dụng" }).click();
    // app hiện tại (Sổ Hợp Tác) hiện trong danh sách nhưng không bấm được
    await expect(page.getByRole("menuitem", { name: /Sổ Hợp Tác/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.getByRole("menuitem", { name: /Chat AI/ })).toBeVisible();
    await page.getByRole("menuitem", { name: /Chat AI/ }).click();
    await page.waitForURL((u) => u.href.startsWith(CHAT), { timeout: 30_000 });
    await settle(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByLabel(/Mật khẩu|Password/)).toHaveCount(0);
    // trở lại Sổ Hợp Tác để các test sau chạy tiếp trên cùng trang
    await go("/overview");
  });
  test("Sản phẩm & Giá: chi tiết sản phẩm dịch vụ có tab Lịch sử · NCC & giá · Khách đang dùng · Hợp đồng", async () => {
    await go("/products?g=service");
    const first = page.locator("main a[href*='sp=']").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/sp=/);
    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: "Lịch sử mua bán" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Nhà cung cấp & giá" }).click();
    await expect(page).toHaveURL(/ht=suppliers/);
    await expect(page.getByText(/So sánh giá nhà cung cấp/).first()).toBeVisible();
    await tabs.getByRole("tab", { name: "Khách đang dùng" }).click();
    await expect(page).toHaveURL(/ht=users/);
    await expect(tabs.getByRole("tab", { name: "Khách đang dùng" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: /^Hợp đồng · \d+$/ }).click();
    await expect(page).toHaveURL(/ht=contracts/);
    expect(await bodyText(page)).not.toMatch(RAW_KEY);
    expect(errs.list).toEqual([]);
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
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("heading", { name: "Cài đặt" })).toBeVisible();
    for (const sec of ["Công ty", "Điểm uy tín", "Điểm kinh doanh"])
      await expect(dlg.getByRole("button", { name: new RegExp(`^${sec}`) })).toBeVisible();
    await dlg.getByRole("button", { name: /^Điểm kinh doanh/ }).click();
    await expect(dlg.getByRole("button", { name: /^Điểm kinh doanh/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(dlg.getByRole("button", { name: "Lưu cài đặt" })).toBeVisible();
    expect(await dlg.innerText()).not.toMatch(RAW_KEY);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
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
    // "Bỏ phòng ban" giữ Group (M1D) ⇒ xoá nốt Group E2E-DEPLOY rỗng qua API.
    await sweepTaggedGroups();
    await expect(page.locator("article").filter({ hasText: TAG })).toHaveCount(0);
    expect(errs.list).toEqual([]);
  });
});

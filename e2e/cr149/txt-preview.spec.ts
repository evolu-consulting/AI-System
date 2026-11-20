// CR-194 · «Xem» tệp .txt trong hộp xem chung (công ty `e2e-par-<hậu tố>`): thêm .txt vào «Tài liệu kèm» ⇒ bấm «Xem» ⇒
// chữ hiện (giữ xuống dòng, thẻ HTML hiện nguyên chữ, không dựng) + «Tải về». Viết sẵn, KHÔNG chạy trong lát.

import { envOf, expect, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { uploadAndOpen } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j10);
const RUN = Date.now().toString(36);

test("Xem tệp .txt trong hộp: hiện chữ, giữ xuống dòng, có Tải về", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  // Stack e2e: FileBox GIẢ ở 127.0.0.1:<cổng ngẫu nhiên> (không có FILEBOX_PUBLIC_PATH + nginx `/_fb` như stg/prod) ⇒ link tải khác origin với web
  // và fake không gửi CORS ⇒ trình duyệt chặn fetch. Thêm header CORS cho link `/d/…` của fake (stg/prod cùng origin qua `/_fb`, không cần).
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/d\//, async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), "access-control-allow-origin": "*" },
    });
  });
  await loginCw(page, E, U.employee);
  await uploadAndOpen(page, E, `cr194-${RUN}`);
  await expect(page.getByTestId("cfiles")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("cfiles-input").setInputFiles({
    name: "ghi-chu.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dòng một CR194\nDòng hai <b>không in đậm</b>\n", "utf8"),
  });
  const row = page.getByTestId("cfile-row").filter({ hasText: "ghi-chu.txt" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "Xem" }).click();
  const dlg = page.getByRole("dialog");
  const body = dlg.getByTestId("text-content");
  await expect(body).toContainText("Dòng một CR194", { timeout: 30_000 });
  await expect(body).toContainText("<b>không in đậm</b>");
  await expect(dlg.locator("pre b")).toHaveCount(0);
  await expect(dlg.getByTestId("fview-download")).toBeVisible();
});

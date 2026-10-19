// L1b (TECH-DEBT #224, L1) · trang Đăng nhập chat-web hiện đúng câu cho giới hạn đăng nhập của admin-api — phản hồi
// `/auth/login` được giả bằng page.route (không cần Redis/khoá thật): 423 TEMP_LOCKED {until} ⇒ giờ mở khoá (giờ trình duyệt,
// Asia/Ho_Chi_Minh); 429 RATE_LIMITED {retry_after_s} + Retry-After ⇒ số phút; 503 AUTH_UNAVAILABLE ⇒ tạm không khả dụng.
import { expect, type Page, test } from "@playwright/test";
import { fillLogin, PASSWORD } from "./_support";

type Mock = { status: number; body: unknown; headers?: Record<string, string> };

async function loginWith(page: Page, m: Mock): Promise<void> {
  await page.route("**/auth/login", (route) =>
    route.fulfill({
      status: m.status,
      contentType: "application/json",
      headers: m.headers,
      body: JSON.stringify(m.body),
    }),
  );
  await page.goto("/login");
  await fillLogin(page, "acme", "minh", PASSWORD);
}

test("L1b · 423 TEMP_LOCKED {until} ⇒ câu tạm khoá kèm giờ mở khoá, không mở hộp khoá vĩnh viễn", async ({
  page,
}) => {
  await loginWith(page, {
    status: 423,
    body: {
      error: {
        code: "TEMP_LOCKED",
        message: "Temporarily locked",
        details: { until: "2026-10-20T03:45:00.000Z" },
      },
    },
  });
  await expect(page.getByRole("alert")).toContainText(
    "Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau 10:45",
  );
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);
});

test("L1b · 429 RATE_LIMITED ⇒ thử lại sau N phút (làm tròn lên)", async ({ page }) => {
  await loginWith(page, {
    status: 429,
    headers: { "Retry-After": "250" },
    body: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts; try again later",
        details: { retry_after_s: 250 },
      },
    },
  });
  await expect(page.getByRole("alert")).toContainText(
    "Thử đăng nhập quá nhiều lần. Hãy thử lại sau 5 phút",
  );
});

test("L1b · 503 AUTH_UNAVAILABLE ⇒ đăng nhập tạm thời không khả dụng (không phải lỗi chung)", async ({
  page,
}) => {
  await loginWith(page, {
    status: 503,
    headers: { "Retry-After": "5" },
    body: {
      error: { code: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable" },
    },
  });
  await expect(page.getByRole("alert")).toContainText(
    "Đăng nhập tạm thời không khả dụng. Hãy thử lại sau ít phút",
  );
});

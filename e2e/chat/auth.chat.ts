// CHAT-AC-01..04 · đăng nhập, làm mới phiên, đăng xuất (test-plan §6 E-A1…A6).
import { expect, test } from "@playwright/test";
import {
  expireAccess,
  fillLogin,
  login,
  openConversation,
  openSettings,
  PASSWORD,
  resetMock,
} from "./_support";

test.beforeEach(async () => {
  await resetMock();
});

async function storageHasJwt(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() =>
    [localStorage, sessionStorage].some((s) =>
      Object.keys(s).some((k) => (s.getItem(k) ?? "").includes("eyJ")),
    ),
  );
}

test("CHAT-AC-01 · đăng nhập acme/minh vào /c/new, thấy lời chào, token không nằm trong storage [E-A1]", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Chào Minh, hôm nay cần gì?" })).toBeVisible();
  expect(await storageHasJwt(page)).toBe(false);
});

test("CHAT-AC-02 · mật khẩu sai ở lại /login, không cookie ai_rt*, không token trong storage [E-A2]", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await fillLogin(page, "acme", "minh", "sai-mat-khau");
  await expect(page.getByRole("alert")).toContainText(
    "Sai mã công ty, tên đăng nhập hoặc mật khẩu",
  );
  await expect(page).toHaveURL(/\/login(\?|$)/);
  // CR-053: cookie phiên theo app (`ai_rt_chat`) — chặn mọi biến thể `ai_rt*`.
  expect((await context.cookies()).some((c) => c.name.startsWith("ai_rt"))).toBe(false);
  expect(await storageHasJwt(page)).toBe(false);
});

test("CHAT-AC-03 · access hết hạn: đúng 1 lần POST /auth/refresh rồi hội thoại hiện [E-A3]", async ({
  page,
}) => {
  await login(page);
  await expireAccess();
  let refreshes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/auth/refresh") refreshes += 1;
  });
  await page.getByRole("link", { name: "Hoá đơn tháng 9 cần đối chiếu", exact: true }).click();
  await expect(page.getByRole("log", { name: "Nội dung hội thoại" })).toBeVisible();
  await expect.poll(() => refreshes).toBe(1);
  await expect(page).not.toHaveURL(/\/login/);
});

test("CHAT-AC-04 · Đăng xuất gọi POST /auth/logout, về /login và không vào lại được [E-A4]", async ({
  page,
}) => {
  await login(page);
  const logout = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/auth/logout",
  );
  const dlg = await openSettings(page);
  await dlg.getByRole("button", { name: "Đăng xuất" }).click();
  await logout;
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await page.goto("/c/new");
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

test("CHAT-AC-03 · refresh cũng hỏng (mất cookie) → về /login với 'Phiên đã hết hạn' [E-A5]", async ({
  page,
  context,
}) => {
  await login(page);
  await expireAccess();
  await context.clearCookies();
  // Sidebar có thể tự làm mới và bị đẩy về /login trước khi kịp bấm: kết quả mới là điều cần kiểm.
  await page
    .getByRole("link", { name: "Hoá đơn tháng 9 cần đối chiếu", exact: true })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Phiên đã hết hạn")).toBeVisible();
});

test("CHAT-AC-01 · tài khoản khoá hiện hộp thoại 'Tài khoản đang bị khoá' [E-A6]", async ({
  page,
}) => {
  await page.goto("/login");
  await fillLogin(page, "acme", "khoa", PASSWORD);
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Tài khoản đang bị khoá. Liên hệ quản trị viên công ty");
  await expect(dlg.getByRole("button", { name: "Đã hiểu" })).toBeVisible();
});

test("CHAT-AC-03 · làm mới phiên giữ nguyên hội thoại đang mở khi tải lại trang [E-A3b]", async ({
  page,
}) => {
  await login(page);
  await openConversation(page, "Soạn email báo giá Minh Phát");
  await page.reload();
  await expect(page.getByRole("log", { name: "Nội dung hội thoại" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

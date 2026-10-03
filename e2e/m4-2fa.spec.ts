// ADM-FR-08 · M4-R16 · M4-AC11 · M4-AC12 · e2e 2FA (test-plan-cd-e2e §5.1 E-2FA-01…13).
// Nhãn nguyên văn: missing-screens §10, plan-frontend §6–7. Mã TOTP theo giờ thật (oracle e2e/support/totp.ts);
// sau mỗi lần dùng mã thành công phải `waitNextStep()` rồi `codeFor(secret, 1)` (mã mỗi bước chỉ dùng một lần).
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  collectTraffic,
  fillLogin,
  leaksOnPage,
  loginAs,
  loginToShell,
  loginUI,
  logoutUI,
  PW,
  resetFixture,
  rowOf,
  toast,
} from "./support/helpers";
import { codeFor, enable2faApi, waitNextStep } from "./support/totp";

const SHELL = (page: Page) => page.getByRole("heading", { level: 1, name: "Tổng quan" });
const WRONG_CREDS = "Mật khẩu hoặc mã không đúng"; // twofa.error.wrongCreds (plan-frontend §7)
const BACKUP_RE = /[a-z0-9]{4}-[a-z0-9]{4}/g;

test.beforeEach(() => {
  test.setTimeout(90_000);
  resetFixture();
});

/** Mã mới của bước TOTP kế tiếp (chờ đổi bước theo điều kiện, không sleep cố định). */
async function freshCode(secret: string): Promise<string> {
  await waitNextStep();
  return codeFor(secret, 1);
}

const codeBox = (scope: Page | Locator) => scope.getByRole("textbox", { name: "Mã xác thực" });

/** Đăng nhập binh đã bật 2FA bằng mã ứng dụng: tới khung quản trị. */
async function loginTotp(page: Page, secret: string, username = "binh") {
  await loginUI(page, "acme", username, PW);
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await codeBox(page).fill(await freshCode(secret));
  await expect(SHELL(page)).toBeVisible();
}

async function open2faPage(page: Page) {
  await page.goto("/account/2fa");
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
}

async function readCodes(list: Locator): Promise<string[]> {
  const text = (await list.getByRole("listitem").allTextContents()).join(" ");
  return text.match(BACKUP_RE) ?? [];
}

/** Bật 2FA qua giao diện (E-2FA-01) tới màn "Lưu mã dự phòng"; trả secret + mã. */
async function enableViaUi(page: Page) {
  await loginToShell(page, "acme", "binh", PW);
  await page.getByRole("button", { name: "Tài khoản của bạn" }).click();
  await page.getByRole("menuitem", { name: "Xác thực hai bước" }).click();
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await expect(page.getByText("Chưa bật", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bật xác thực hai bước" }).click();
  await page.getByLabel("Mật khẩu hiện tại").fill(PW);
  const setup = page.waitForResponse((r) => /\/auth\/totp\/setup/.test(r.url()));
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const secret = ((await (await setup).json()) as { secret: string }).secret;
  await expect(
    page.getByRole("img", { name: "Mã QR để thêm tài khoản vào ứng dụng xác thực" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  return { secret };
}

test("ADM-FR-08 · E-2FA-01 · M4-AC11 · binh bật 2FA qua UI: mật khẩu → QR → mã → 10 mã dự phòng → tick → Hoàn tất → 'Đã bật · còn 10 mã dự phòng'", async ({
  page,
}) => {
  const { secret } = await enableViaUi(page);
  const enable = page.waitForResponse((r) => /\/auth\/totp\/enable/.test(r.url()));
  await codeBox(page).fill(codeFor(secret, 0));
  expect((await enable).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Lưu mã dự phòng" })).toBeVisible();
  const list = page.getByRole("list", { name: "Mã dự phòng" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const done = page.getByRole("button", { name: "Hoàn tất" });
  await expect(done).toBeDisabled();
  await page.getByRole("checkbox", { name: "Tôi đã lưu mã dự phòng ở nơi an toàn" }).check();
  await expect(done).toBeEnabled();
  await done.click();
  await expect(toast(page, "Đã bật xác thực hai bước")).toBeVisible();
  await expect(page.getByText("Đã bật", { exact: true })).toBeVisible();
  await expect(page.getByText(/còn 10 mã dự phòng/)).toBeVisible();
});

test("ADM-FR-08 · E-2FA-02 · mã sai ở bước bật → 'Mã không đúng. Kiểm tra giờ trên điện thoại và thử lại.'", async ({
  page,
}) => {
  const { secret } = await enableViaUi(page);
  const enable = page.waitForResponse((r) => /\/auth\/totp\/enable/.test(r.url()));
  await codeBox(page).fill(codeFor(secret, 5));
  expect((await enable).status()).toBe(400);
  await expect(
    page.getByText("Mã không đúng. Kiểm tra giờ trên điện thoại và thử lại."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lưu mã dự phòng" })).toHaveCount(0);
});

test("ADM-FR-08 · E-2FA-03 · bước đăng nhập: 'acme · binh'; mã sai → 'Mã không đúng hoặc đã hết hạn'; mã đúng → vào khung", async ({
  page,
  request,
}) => {
  const { secret } = await enable2faApi(request, "acme", "binh", PW);
  await page.goto("/login");
  await fillLogin(page, "acme", "binh", PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await expect(page.getByText("acme · binh")).toBeVisible();
  await codeBox(page).fill(codeFor(secret, 5));
  await expect(
    page.getByRole("alert").filter({ hasText: "Mã không đúng hoặc đã hết hạn" }),
  ).toBeVisible();
  await codeBox(page).fill(await freshCode(secret));
  await expect(SHELL(page)).toBeVisible();
});

test("ADM-FR-08 · E-2FA-04 · mã dự phòng dùng được một lần; 'Dùng mã từ ứng dụng' đổi lại ô 'Mã xác thực'", async ({
  page,
  request,
}) => {
  const { backupCodes } = await enable2faApi(request, "acme", "binh", PW);
  const viaBackup = async () => {
    await loginUI(page, "acme", "binh", PW);
    await page.getByRole("button", { name: "Dùng mã dự phòng" }).click();
    await page.getByRole("textbox", { name: "Mã dự phòng" }).fill(backupCodes[0] as string);
    await page.getByRole("button", { name: "Xác nhận" }).click();
  };
  await viaBackup();
  await expect(SHELL(page)).toBeVisible();
  await logoutUI(page);
  await viaBackup();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mã không đúng hoặc đã hết hạn" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dùng mã từ ứng dụng" }).click();
  await expect(codeBox(page)).toBeVisible();
});

test("ADM-FR-08 · E-2FA-05 · 'Quay lại đăng nhập' giữ mã công ty và tên đăng nhập", async ({
  page,
  request,
}) => {
  await enable2faApi(request, "acme", "binh", PW);
  await loginUI(page, "acme", "binh", PW);
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await page.getByRole("link", { name: "Quay lại đăng nhập" }).click();
  await expect(page.getByRole("textbox", { name: "Mã công ty" })).toHaveValue("acme");
  await expect(page.getByRole("textbox", { name: "Tên đăng nhập" })).toHaveValue("binh");
});

test("ADM-FR-08 · E-2FA-06 · khoá tạm: 5 mã sai chỉ báo sai; lần 6 → 'Tạm khoá đến hh:mm'", async ({
  page,
  request,
}) => {
  const { secret } = await enable2faApi(request, "acme", "binh", PW);
  await loginUI(page, "acme", "binh", PW);
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  const wrong = page.getByRole("alert").filter({ hasText: "Mã không đúng hoặc đã hết hạn" });
  for (let i = 0; i < 5; i++) {
    const res = page.waitForResponse((r) => /\/auth\/totp\/verify/.test(r.url()));
    await codeBox(page).fill(codeFor(secret, 5 + i));
    expect((await res).status()).toBe(401);
    await expect(wrong).toBeVisible();
    await expect(page.getByText(/Tạm khoá đến/)).toHaveCount(0);
  }
  const sixth = page.waitForResponse((r) => /\/auth\/totp\/verify/.test(r.url()));
  await codeBox(page).fill(codeFor(secret, 11));
  expect((await sixth).status()).toBe(423);
  await expect(
    page.getByRole("alert").filter({ hasText: /^Tạm khoá đến \d{2}:\d{2}$/ }),
  ).toBeVisible();
});

test("ADM-FR-08 · E-2FA-07 · Q-D1 · tạo lại mã dự phòng: 10 mã mới khác danh sách cũ, toast 'Đã tạo mã dự phòng mới'", async ({
  page,
  request,
}) => {
  const { secret, backupCodes } = await enable2faApi(request, "acme", "binh", PW);
  await loginTotp(page, secret);
  await open2faPage(page);
  await page.getByRole("button", { name: "Tạo lại mã dự phòng" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Tạo lại mã dự phòng?" });
  await expect(dialog).toBeVisible();
  await codeBox(dialog).fill(await freshCode(secret));
  const regen = page.waitForResponse((r) => /\/auth\/totp\/backup-codes/.test(r.url()));
  await dialog.getByRole("button", { name: "Tạo lại", exact: true }).click();
  expect((await regen).status()).toBe(200);
  const list = page.getByRole("list", { name: "Mã dự phòng" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const fresh = await readCodes(list);
  expect(fresh).toHaveLength(10);
  expect(fresh.filter((c) => backupCodes.includes(c))).toEqual([]);
  await expect(toast(page, "Đã tạo mã dự phòng mới")).toBeVisible();
});

test("ADM-FR-08 · E-2FA-08 · tự tắt 2FA: mật khẩu + mã → toast, 'Chưa bật', đăng nhập lần sau không có bước mã", async ({
  page,
  request,
}) => {
  const { secret } = await enable2faApi(request, "acme", "binh", PW);
  await loginTotp(page, secret);
  await open2faPage(page);
  await page.getByRole("button", { name: "Tắt xác thực hai bước" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Tắt xác thực hai bước?" });
  await dialog.getByLabel("Mật khẩu hiện tại").fill(PW);
  await codeBox(dialog).fill(await freshCode(secret));
  const off = page.waitForResponse((r) => /\/auth\/totp\/disable/.test(r.url()));
  await dialog.getByRole("button", { name: "Tắt xác thực hai bước" }).click();
  expect((await off).status()).toBe(204);
  await expect(toast(page, "Đã tắt xác thực hai bước")).toBeVisible();
  await expect(page.getByText("Chưa bật", { exact: true })).toBeVisible();
  await logoutUI(page);
  await loginToShell(page, "acme", "binh", PW);
});

test("ADM-FR-08 · E-2FA-09 · D11 · secret, mã dự phòng và totp_token không lộ ở URL, storage, cookie, console, DOM", async ({
  page,
}) => {
  const t = collectTraffic(page);
  const { secret } = await enableViaUi(page);
  const enable = page.waitForResponse((r) => /\/auth\/totp\/enable/.test(r.url()));
  await codeBox(page).fill(codeFor(secret, 0));
  await enable;
  const list = page.getByRole("list", { name: "Mã dự phòng" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = await readCodes(list);
  expect(codes).toHaveLength(10);
  await page.getByRole("checkbox", { name: "Tôi đã lưu mã dự phòng ở nơi an toàn" }).check();
  await page.getByRole("button", { name: "Hoàn tất" }).click();
  await expect(toast(page, "Đã bật xác thực hai bước")).toBeVisible();
  // Sau Hoàn tất: DOM không còn secret/mã; storage/cookie/console cũng sạch.
  const clientOnly = async (forms: string[]) =>
    (await leaksOnPage(page, t, forms)).filter((k) => !["responses", "otherRequests"].includes(k));
  expect(await clientOnly([secret, ...codes])).toEqual([]);
  // Bước nhập mã đăng nhập: totp_token lấy từ response /auth/login.
  await logoutUI(page);
  const login = page.waitForResponse((r) => /\/auth\/login/.test(r.url()));
  await loginUI(page, "acme", "binh", PW);
  const totpToken = ((await (await login).json()) as { totp_token?: string }).totp_token;
  expect(typeof totpToken).toBe("string");
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await page.getByRole("button", { name: "Dùng mã dự phòng" }).click();
  await page.getByRole("textbox", { name: "Mã dự phòng" }).fill(codes[0] as string);
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(SHELL(page)).toBeVisible();
  const cookies = JSON.stringify(await page.context().cookies());
  for (const f of [secret, ...codes, totpToken as string]) expect(cookies).not.toContain(f);
  expect(page.url()).not.toContain(totpToken as string);
  expect(await clientOnly([secret, ...codes, totpToken as string])).toEqual([]);
});

test("ADM-FR-08 · E-2FA-10 · totp_token hết hạn (401 INVALID_TOTP_TOKEN) → 'Phiên xác thực đã hết hạn. Hãy đăng nhập lại.' và về form đăng nhập", async ({
  page,
  request,
}) => {
  const { secret } = await enable2faApi(request, "acme", "binh", PW);
  await page.route("**/auth/totp/verify", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INVALID_TOTP_TOKEN", message: "expired", details: {} },
      }),
    }),
  );
  await loginUI(page, "acme", "binh", PW);
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await codeBox(page).fill(codeFor(secret, 0));
  await expect(page.getByText("Phiên xác thực đã hết hạn. Hãy đăng nhập lại.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Tên đăng nhập" })).toBeVisible();
});

test("ADM-FR-08 · E-2FA-11 · tắt hộ: binh tắt 2FA của chi (toast); hàng binh và hàng an không có 'Tắt 2FA'", async ({
  page,
  request,
}) => {
  await enable2faApi(request, "acme", "chi", PW);
  await loginAs(page, "acme", "binh");
  await page.goto("/users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
  await rowOf(page, "Users", "chi").getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Tắt 2FA" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Tắt 2FA của chi?" });
  await expect(dialog).toBeVisible();
  const done = page.waitForResponse((r) => /\/admin\/users\/[^/]+\/totp\/disable/.test(r.url()));
  await dialog.getByRole("button", { name: "Tắt 2FA" }).click();
  expect((await done).status()).toBe(200);
  await expect(toast(page, "Đã tắt 2FA của chi")).toBeVisible();
  for (const username of ["binh", "an"]) {
    await rowOf(page, "Users", username).getByRole("button", { name: "Thao tác khác" }).click();
    await expect(page.getByRole("menuitem", { name: "Sửa", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Tắt 2FA" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("ADM-FR-08 · E-2FA-12 · M4-AC12 · an (member): menu không có 'Xác thực hai bước'; /account/2fa → /member", async ({
  page,
}) => {
  await loginUI(page, "acme", "an", PW);
  await expect(
    page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" }),
  ).toBeVisible();
  await page.goto("/account/2fa");
  await expect(page).toHaveURL(/\/member$/);
  const menu = page.getByRole("button", { name: "Tài khoản của bạn" });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Xác thực hai bước" })).toHaveCount(0);
  }
});

test("ADM-FR-08 · E-2FA-13 · mật khẩu/mã sai ở dialog tắt và dialog tạo lại → 'Mật khẩu hoặc mã không đúng' trong dialog; dialog còn mở, 2FA vẫn bật", async ({
  page,
  request,
}) => {
  const { secret } = await enable2faApi(request, "acme", "binh", PW);
  await loginTotp(page, secret);
  await open2faPage(page);

  await page.getByRole("button", { name: "Tắt xác thực hai bước" }).click();
  const off = page.getByRole("alertdialog", { name: "Tắt xác thực hai bước?" });
  const submitOff = off.getByRole("button", { name: "Tắt xác thực hai bước" });
  // mật khẩu sai, mã đúng định dạng
  await off.getByLabel("Mật khẩu hiện tại").fill("Sai-Passw0rd-9");
  await codeBox(off).fill(codeFor(secret, 5));
  await submitOff.click();
  await expect(off.getByRole("alert").filter({ hasText: WRONG_CREDS })).toBeVisible();
  // mật khẩu đúng, mã sai
  await off.getByLabel("Mật khẩu hiện tại").fill(PW);
  await codeBox(off).fill(codeFor(secret, 6));
  await submitOff.click();
  await expect(off.getByRole("alert").filter({ hasText: WRONG_CREDS })).toBeVisible();
  await expect(off).toBeVisible();
  await off.getByRole("button", { name: "Huỷ" }).click();
  await expect(off).toHaveCount(0);

  await page.getByRole("button", { name: "Tạo lại mã dự phòng" }).click();
  const regen = page.getByRole("alertdialog", { name: "Tạo lại mã dự phòng?" });
  await codeBox(regen).fill(codeFor(secret, 7));
  await regen.getByRole("button", { name: "Tạo lại", exact: true }).click();
  await expect(regen.getByRole("alert").filter({ hasText: WRONG_CREDS })).toBeVisible();
  await expect(regen).toBeVisible();
  await regen.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByText("Đã bật", { exact: true })).toBeVisible();
});

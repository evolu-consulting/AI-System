// CR-118 · cr118-auth · login gộp + một phiên `contracts` trên stack thật (tenant demo): thành viên SHT vào /overview, đăng xuất
// xoá phiên; đối tác lần đầu buộc đổi mật khẩu rồi vào /community, gõ path SHT về /community (không gọi /pack/contracts);
// TOTP: đăng nhập phải qua bước mã. Chạy theo thứ tự (TOTP bật cuối cho demo-owner). Mật khẩu không nằm trong repo.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { codeFor, enable2faApi, waitNextStep } from "../support/totp";

test.describe.configure({ mode: "serial" });

const TENANT = "demo";
const OWNER = "demo-owner";
const PARTNER = "doitac-tanphat";
const NEW_PW = "Ss-e2e-Pass-2026!";
const ownerPw = (): string => {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
  const v = process.env.DEMO_OWNER_PW;
  if (!v) throw new Error("cần DEMO_OWNER_PW");
  return v;
};
function partnerPw(): string {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
  const file = process.env.SS_SEED_PW_FILE;
  if (!file) throw new Error("cần SS_SEED_PW_FILE");
  const pw = (JSON.parse(readFileSync(file, "utf8")) as { users?: Record<string, string> }).users?.[
    PARTNER
  ];
  if (!pw) throw new Error(`file mật khẩu không có ${PARTNER}`);
  return pw;
}

async function fillLogin(page: Page, user: string, pw: string): Promise<void> {
  const tenant = page.getByRole("textbox", { name: "Mã công ty" });
  const change = page.getByRole("button", { name: "Đổi công ty" });
  await expect(tenant.or(change)).toBeVisible(); // trang /login nạp lười: chờ form trước khi xem ô nào hiện
  if (!(await tenant.isVisible())) await change.click();
  await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.locator("input[name=password]").fill(pw);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

const refreshStatus = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch("/auth/refresh", { method: "POST", headers: { "X-App": "contracts" } });
    return r.status;
  });

test("thành viên SHT: đăng nhập vào /overview, đăng xuất xoá phiên", async ({ page }) => {
  await page.goto("/contracts");
  await expect(page).toHaveURL(/\/login\?/);
  await fillLogin(page, OWNER, ownerPw());
  await expect(page).toHaveURL(/\/contracts$/);
  expect(await refreshStatus(page)).toBe(200);
  // đăng xuất qua phiên chung (cùng một cookie ai_rt_contracts cho cả SHT và Community)
  await page.goto("/community");
  await expect(page.getByRole("link", { name: "Bảng tin" })).toBeVisible();
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Đăng xuất" }).click(); // menu chung hỏi xác nhận
  await expect(page).toHaveURL(/\/login/);
  expect(await refreshStatus(page)).toBe(401);
  await page.goto("/contracts");
  await expect(page).toHaveURL(/\/login\?/);
});

test("MỘT khung (CR-120): Sổ Hợp Tác ↔ Community đổi trang trong app — không tải lại, cùng sidebar/topbar, mục menu là <Link> không ↗", async ({
  page,
}) => {
  await page.goto("/contracts");
  await fillLogin(page, OWNER, ownerPw());
  await expect(page).toHaveURL(/\/contracts$/);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByTestId("nav-group-contracts")).toBeVisible();
  await expect(nav.getByTestId("nav-group-community")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __noReload: number; __loaded?: boolean };
    w.__noReload = 1;
    window.addEventListener("load", () => {
      w.__loaded = true;
    });
  });
  const entries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const sameShell = async () => {
    await expect(page.locator("header.top")).toHaveCount(0); // không còn khung riêng của Community
    await expect(nav.locator("a[target], .ext")).toHaveCount(0); // không link ngoài / biểu tượng ↗
    await expect(page.getByRole("button", { name: "Tài khoản" })).toBeVisible();
  };
  await nav.getByRole("link", { name: "Bảng tin" }).click(); // SHT → Community
  await expect(page).toHaveURL(/\/community$/);
  await sameShell();
  await nav.getByRole("link", { name: "Hợp đồng & giao dịch" }).click(); // Community → SHT
  await expect(page).toHaveURL(/\/contracts\/list$/);
  await sameShell();
  await nav.getByRole("link", { name: "Bài đăng của tôi" }).click(); // SHT → Community (hồ sơ)
  await expect(page).toHaveURL(/\/community\/profile$/);
  await sameShell();
  const w = () =>
    page.evaluate(() => {
      const x = window as unknown as { __noReload?: number; __loaded?: boolean };
      return {
        marker: x.__noReload,
        loaded: x.__loaded,
        nav: performance.getEntriesByType("navigation").length,
      };
    });
  expect(await w()).toEqual({ marker: 1, loaded: undefined, nav: entries });
});

test("đối tác lần đầu: buộc đổi mật khẩu rồi vào /community, gõ /overview về /community", async ({
  page,
}) => {
  const packContracts: string[] = [];
  page.on("request", (r) => {
    if (/\/pack\/contracts\//.test(r.url())) packContracts.push(r.url());
  });
  await page.goto("/login");
  await fillLogin(page, PARTNER, partnerPw());
  await expect(page.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PW);
  await page.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PW);
  await page.getByRole("button", { name: "Lưu mật khẩu" }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole("link", { name: "Bảng tin" })).toBeVisible();
  // đối tác (không gói contracts): khung chung chỉ có nhóm Community, không phát sinh mục/đường dẫn Sổ Hợp Tác
  await expect(page.getByTestId("nav-group-community")).toBeVisible();
  await expect(page.getByTestId("nav-group-contracts")).toHaveCount(0);
  await expect(page.locator('a[href^="/contracts"]')).toHaveCount(0);
  for (const path of ["/overview", "/contracts", "/partners"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/community$/);
  }
  expect(packContracts).toEqual([]);
});

test("TOTP: đăng nhập phải qua bước mã", async ({ page, request }) => {
  const { secret } = await enable2faApi(request, TENANT, OWNER, ownerPw());
  await page.goto("/login");
  await fillLogin(page, OWNER, ownerPw());
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await page.getByRole("textbox", { name: "Mã xác thực" }).fill(codeFor(secret, 5));
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("alert")).toHaveText("Mã xác thực không đúng.");
  await waitNextStep();
  await page.getByRole("textbox", { name: "Mã xác thực" }).fill(codeFor(secret, 0));
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page).toHaveURL(/\/contracts$/);
});

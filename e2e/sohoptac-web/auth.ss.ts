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
  const v = process.env.DEMO_OWNER_PW;
  if (!v) throw new Error("cần DEMO_OWNER_PW");
  return v;
};
function partnerPw(): string {
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
  if (!(await tenant.isVisible())) await page.getByRole("button", { name: "Đổi công ty" }).click();
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
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?/);
  await fillLogin(page, OWNER, ownerPw());
  await expect(page).toHaveURL(/\/overview$/);
  expect(await refreshStatus(page)).toBe(200);
  // đăng xuất qua phiên chung (cùng một cookie ai_rt_contracts cho cả SHT và Community)
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: "Cộng đồng" })).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await refreshStatus(page)).toBe(401);
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?/);
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
  await expect(page.getByRole("heading", { name: "Cộng đồng" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/overview$/);
});

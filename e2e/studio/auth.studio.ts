// HUB-FR-72 · H4a-AC-01, AC-02 · H4a-R01, R02, R14 · plan-frontend §2, §6 · test-plan H4a §3 E01–E05: đăng nhập Studio,
// trang "không có quyền" cho role khác (không gọi API cấu hình), khung + menu (mục chưa làm "Sắp có", badge hub config),
// URL đích giữ qua đăng nhập (`next`), 404; E14 bước TOTP (QF2).
import { expect, test } from "@playwright/test";
import { login, mockStudio, openAuthed, TOTP_CODE } from "./_support";

test("HUB-FR-72 · E01 · chưa phiên → /login?next=; đăng nhập platform_admin → về đúng trang đích + badge `hub config v7` [H4a-R14 · H4a-AC-02]", async ({
  page,
}) => {
  await mockStudio(page);
  await page.goto("/studio/orchestrator");
  await expect(page).toHaveURL(/\/studio\/login\?next=/);
  await expect(page.getByRole("heading", { name: "Đăng nhập Agent Studio" })).toBeVisible();
  await login(page);
  await expect(page).toHaveURL(/\/studio\/orchestrator$/);
  await expect(page.getByRole("heading", { name: "Orchestrator", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Phiên bản cấu hình Hub" })).toContainText(
    "hub config v7",
  );
});

test("HUB-FR-72 · E02 · sai mật khẩu → alert lỗi, ở lại trang đăng nhập [H4a-R14]", async ({
  page,
}) => {
  await mockStudio(page);
  await page.goto("/studio/login");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("padmin");
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill("sai-mat-khau");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sai mã công ty, tên đăng nhập hoặc mật khẩu.",
  );
  await expect(page).toHaveURL(/\/studio\/login/);
});

for (const role of ["tenant_admin", "member"] as const) {
  test(`HUB-FR-72 · E03 · ${role} đăng nhập → "Bạn không có quyền vào Agent Studio" + Về Chat; chỉ gọi /me, không gọi API cấu hình [H4a-AC-01 · H4a-R01]`, async ({
    page,
  }) => {
    const s = await mockStudio(page, { role });
    await page.goto("/studio/agents");
    await login(page, "tadmin", "acme");
    await expect(page).toHaveURL(/\/studio\/forbidden/);
    await expect(
      page.getByRole("heading", { name: "Bạn không có quyền vào Agent Studio" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /me"]);
  });
}

test('HUB-FR-72 · E04 · khung: menu Studio có link Agents + Orchestrator; Models là mục aria-disabled "Sắp có"; ⇄ Admin [H4a-AC-02 · spec §1]', async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await openAuthed(page, "/agents");
  const nav = page.getByRole("navigation", { name: "Menu Studio" });
  await expect(nav.getByRole("link", { name: "Agents" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Orchestrator" })).toBeVisible();
  const models = nav.getByText("Models", { exact: true });
  await expect(models).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: "Models" })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Models" })).toHaveCount(0);
  await expect(nav.getByText("Sắp có").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "⇄ Admin" })).toBeVisible();
});

test('HUB-FR-72 · E05 · `/studio/` → /agents; đường dẫn lạ → "Không tìm thấy trang" + Về Agents [plan-frontend §2]', async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await page.goto("/studio/");
  await expect(page).toHaveURL(/\/studio\/agents/);
  await page.goto("/studio/khong-co-trang-nay");
  await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible();
  await page.getByRole("link", { name: "Về Agents" }).click();
  await expect(page).toHaveURL(/\/studio\/agents/);
});

test("HUB-FR-72 · E14 · tài khoản bật 2FA: sau mật khẩu hiện bước `Mã xác thực`; mã sai ⇒ alert, ở lại; mã đúng ⇒ vào đúng trang đích [H4a-QF2 · H4a-R14]", async ({
  page,
}) => {
  await mockStudio(page, { totp: true });
  await page.goto("/studio/agents");
  await expect(page).toHaveURL(/\/studio\/login\?next=/);
  await login(page);
  const code = page.getByRole("textbox", { name: "Mã xác thực" });
  await expect(code).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/login/);

  await code.fill("000000");
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/login/);

  await code.fill(TOTP_CODE);
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page).toHaveURL(/\/studio\/agents$/);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
});

// ADM-FR-50, ADM-BR-04, ADM-BR-14 · e2e Secrets (test-plan E-S; AC-A06; M2-R03, M2-R05).
// Nhãn nguyên văn: admin-missing-screens §6 + plan-frontend §5. Không waitForTimeout; điều hướng bọc waitForURL/expect.
import { expect, type Page, test } from "@playwright/test";
import {
  collectTraffic,
  LEAK_1,
  LEAK_2,
  leakForms,
  leaksOnPage,
  loginAdmin,
  loginToShell,
  loginUI,
  openPage,
  PW,
  resetFixture,
  rowOf,
  seedAdmin,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });

test("ADM-BR-14 · M2-AC01 · menu: admin thấy Secrets/Workflows/Commands/Features; tenant_admin (binh) không thấy mục nào và /secrets → ForbiddenState, không gọi API secrets", async ({
  page,
  browser,
}) => {
  await loginAdmin(page);
  for (const name of ["Secrets", "Workflows", "Commands", "Features"]) {
    await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
  }
  const ctx = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  try {
    const other = await ctx.newPage();
    const calls: string[] = [];
    other.on("request", (r) => calls.push(r.url()));
    await loginToShell(other, "acme", "binh", PW);
    for (const name of ["Secrets", "Workflows", "Commands", "Features"]) {
      await expect(nav(other).getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await other.goto("/secrets");
    await expect(
      other.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
    ).toBeVisible();
    expect(calls.filter((u) => u.includes("/admin/secrets"))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("ADM-FR-50 · M2-R26 · /secrets: heading, bảng, •••• 7f3a, chip Tất cả 3 / Đang dùng 2 / Chưa dùng 1; bấm chip đổi URL ?used=", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  await expect(page.getByRole("table", { name: "Secrets" })).toBeVisible();
  await expect(rowOf(page, "Secrets", "DIFY_TRANSLATE_KEY")).toContainText("•••• 7f3a");
  await expect(page.getByRole("radio", { name: /Tất cả\s*3/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Đang dùng\s*2/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Chưa dùng\s*1/ })).toBeVisible();
  await page.getByRole("radio", { name: /Chưa dùng/ }).click();
  await expect(page).toHaveURL(/used=false/);
  await expect(rowOf(page, "Secrets", "DIFY_OLD_KEY")).toBeVisible();
  await expect(rowOf(page, "Secrets", "DIFY_TRANSLATE_KEY")).toHaveCount(0);
});

test("ADM-FR-50 · M2-R01 · thêm secret: tên tự chuẩn hoá HOA/_ ; nút Hiện/Ẩn giá trị đang gõ; Lưu → toast 'Đã thêm DIFY_NEW_KEY' và hàng mới chỉ có •••• last4", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const name = drawer.getByLabel("Tên", { exact: true });
  await name.fill("dify new key");
  await expect(name).toHaveValue("DIFY_NEW_KEY");
  const value = drawer.getByLabel("Giá trị", { exact: true });
  await value.fill("12345678");
  await expect(value).toHaveAttribute("type", "password");
  await drawer.getByRole("button", { name: "Hiện giá trị đang gõ" }).click();
  await expect(value).toHaveAttribute("type", "text");
  await drawer.getByRole("button", { name: "Ẩn giá trị" }).click();
  await expect(value).toHaveAttribute("type", "password");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/secrets") && r.request().method() === "POST",
  );
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(toast(page, "Đã thêm DIFY_NEW_KEY")).toBeVisible();
  await expect(rowOf(page, "Secrets", "DIFY_NEW_KEY")).toContainText("•••• 5678");
});

test("AC-A06 · ADM-BR-04 · quét rò: sau khi thêm secret với LEAK_1, DOM/localStorage/sessionStorage/cookie/URL/title/console và mọi body response không chứa giá trị; request body chỉ chứa nó ở POST /admin/secrets", async ({
  page,
}) => {
  await loginAdmin(page);
  const traffic = collectTraffic(page);
  await openPage(page, "/secrets", "Secrets");
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Tên", { exact: true }).fill("DIFY_LEAK_KEY");
  await drawer.getByLabel("Giá trị", { exact: true }).fill(LEAK_1);
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/secrets") && r.request().method() === "POST",
  );
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(rowOf(page, "Secrets", "DIFY_LEAK_KEY")).toBeVisible();
  expect(await leaksOnPage(page, traffic, leakForms(LEAK_1))).toEqual([]);
  expect(traffic.requests.some((r) => r.method === "POST" && (r.post ?? "").includes(LEAK_1))).toBe(
    true,
  );
  // HTML + asset JS tĩnh của web không chứa giá trị.
  const html = await page.request.get("/");
  const htmlText = await html.text();
  expect(htmlText).not.toContain(LEAK_1);
  const scripts = [...htmlText.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1] ?? "");
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    expect(await (await page.request.get(src)).text()).not.toContain(LEAK_1);
  }
});

test("ADM-FR-50 · M2-R01 · M2-R04 · validate: tên 'a' → 'Chỉ dùng chữ HOA, số và _ (2–64 ký tự)'; giá trị rỗng → 'Nhập giá trị secret'; tên trùng → 'Tên secret đã tồn tại'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Tên", { exact: true }).fill("a");
  await drawer.getByLabel("Giá trị", { exact: true }).fill("12345678");
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(drawer.getByText("Chỉ dùng chữ HOA, số và _ (2–64 ký tự)")).toBeVisible();
  await drawer.getByLabel("Tên", { exact: true }).fill("DIFY_VALID_NAME");
  await drawer.getByLabel("Giá trị", { exact: true }).fill("");
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(drawer.getByText("Nhập giá trị secret")).toBeVisible();
  await drawer.getByLabel("Tên", { exact: true }).fill("DIFY_TRANSLATE_KEY");
  await drawer.getByLabel("Giá trị", { exact: true }).fill("12345678");
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(drawer.getByText("Tên secret đã tồn tại")).toBeVisible();
});

test("ADM-FR-50 · M2-R04 · AC-A06 · Thay giá trị: dialog 'DIFY_TRANSLATE_KEY', dòng hiện tại •••• 7f3a, ô Giá trị mới TRỐNG, DependencyList translate; lưu → toast + nút 'Xem các workflow dùng secret này' → /workflows?secret=; không rò LEAK_2", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  const traffic = collectTraffic(page);
  await rowOf(page, "Secrets", "DIFY_TRANSLATE_KEY")
    .getByRole("button", { name: "Thao tác khác" })
    .click();
  await page.getByRole("menuitem", { name: "Thay giá trị", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "DIFY_TRANSLATE_KEY" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Giá trị hiện tại: •••• 7f3a");
  await expect(dialog).toContainText("translate");
  const input = dialog.getByLabel("Giá trị mới", { exact: true });
  await expect(input).toHaveValue("");
  await input.fill(LEAK_2);
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/secrets/DIFY_TRANSLATE_KEY") && r.request().method() === "PUT",
  );
  await dialog.getByRole("button", { name: "Lưu giá trị mới" }).click();
  expect((await saved).status()).toBe(200);
  const t = toast(page, `Đã thay giá trị DIFY_TRANSLATE_KEY · •••• ${LEAK_2.slice(-4)}`);
  await expect(t).toBeVisible();
  expect(await leaksOnPage(page, traffic, leakForms(LEAK_2))).toEqual([]);
  await t.getByRole("button", { name: "Xem các workflow dùng secret này" }).click();
  await expect(page).toHaveURL(/\/workflows\?.*secret=DIFY_TRANSLATE_KEY/);
});

test("ADM-FR-50 · M2-R04 · Sửa ghi chú: chỉ có ô Ghi chú (không có ô giá trị); lưu → hàng đổi ghi chú, •••• 7f3a giữ nguyên", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  await rowOf(page, "Secrets", "DIFY_INVOICE_KEY")
    .getByRole("button", { name: "Thao tác khác" })
    .click();
  await page.getByRole("menuitem", { name: "Sửa ghi chú", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("Giá trị", { exact: true })).toHaveCount(0);
  await expect(drawer.getByLabel("Giá trị mới", { exact: true })).toHaveCount(0);
  await drawer.getByLabel("Ghi chú", { exact: true }).fill("Ghi chú hoá đơn mới");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/secrets/DIFY_INVOICE_KEY") && r.request().method() === "PATCH",
  );
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(rowOf(page, "Secrets", "DIFY_INVOICE_KEY")).toContainText("Ghi chú hoá đơn mới");
  await expect(rowOf(page, "Secrets", "DIFY_INVOICE_KEY")).toContainText("•••• 91c2");
});

test("ADM-FR-50 · M2-R05 · xoá: đang dùng → alertdialog 'Không xoá được DIFY_TRANSLATE_KEY' + translate + Đóng; không dùng → 'Xoá DIFY_OLD_KEY?' gõ tên mới bật nút → toast 'Đã xoá DIFY_OLD_KEY'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/secrets", "Secrets");
  await rowOf(page, "Secrets", "DIFY_TRANSLATE_KEY")
    .getByRole("button", { name: "Thao tác khác" })
    .click();
  await page.getByRole("menuitem", { name: "Xoá", exact: true }).click();
  const blocked = page.getByRole("alertdialog", { name: "Không xoá được DIFY_TRANSLATE_KEY" });
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("translate");
  await blocked.getByRole("button", { name: "Đóng" }).click();
  await expect(blocked).toHaveCount(0);
  await rowOf(page, "Secrets", "DIFY_OLD_KEY")
    .getByRole("button", { name: "Thao tác khác" })
    .click();
  await page.getByRole("menuitem", { name: "Xoá", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Xoá DIFY_OLD_KEY?" });
  await expect(confirm).toBeVisible();
  const submit = confirm.getByRole("button", { name: /^Xoá( secret)?$/ });
  await expect(submit).toBeDisabled();
  await confirm.getByRole("textbox", { name: "Gõ DIFY_OLD_KEY để xác nhận" }).fill("DIFY_OLD_KEY");
  await expect(submit).toBeEnabled();
  const deleted = page.waitForResponse(
    (r) => r.url().includes("/admin/secrets/DIFY_OLD_KEY") && r.request().method() === "DELETE",
  );
  await submit.click();
  expect((await deleted).status()).toBe(204);
  await expect(toast(page, "Đã xoá DIFY_OLD_KEY")).toBeVisible();
  await expect(rowOf(page, "Secrets", "DIFY_OLD_KEY")).toHaveCount(0);
});

test("ADM-FR-50 · M2-R28 · locale EN của user: heading 'Secrets', nút '+ Add secret', menu 'Replace value'; không còn khoá i18n thô", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    await sql`update admin.users set locale = 'en' where username = 'admin' and tenant_id in (select id from admin.tenants where key = 'platform')`;
  });
  try {
    // Đăng nhập không phụ thuộc ngôn ngữ: sau khi vào, M1 đổi ngôn ngữ theo user.locale nên H1 là "Overview" (không phải
    // "Tổng quan" như loginAdmin chờ) → chờ rời /login thay vì chờ heading.
    const admin = seedAdmin();
    await loginUI(page, "platform", admin.username, admin.password);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    // Điều hướng trong app (không page.goto/reload) để giữ ngôn ngữ đã đặt lúc đăng nhập.
    await page.getByRole("navigation").getByRole("link", { name: "Secrets", exact: true }).click();
    await expect(page).toHaveURL(/\/secrets/);
    await expect(page.getByRole("heading", { level: 1, name: "Secrets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add secret" })).toBeVisible();
    await rowOf(page, "Secrets", "DIFY_INVOICE_KEY")
      .getByRole("button", { name: /More actions|Thao tác khác/ })
      .click();
    await expect(page.getByRole("menuitem", { name: "Replace value", exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\bsecrets\.[a-z]+\.[a-zA-Z]+\b/);
  } finally {
    await withOwner(async (sql) => {
      await sql`update admin.users set locale = 'vi' where username = 'admin'`;
    });
  }
});

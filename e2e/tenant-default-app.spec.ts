// tenant-default-app · platform_admin đặt "App mặc định" của công ty ở trang chi tiết tenant. Đăng nhập + chi tiết tenant chạy
// admin-api THẬT; `/admin/tenants/:id/default-app` và `/admin/apps` giả bằng `page.route` (hành vi API phủ ở int
// apps/admin-api/src/modules/app-catalog/tenant-default-app.int.test.ts).
import { expect, test } from "@playwright/test";
import { loginToShell, resetFixture, seedAdmin, TENANT_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

test("platform_admin mở tenant acme → ô App mặc định: chọn Sổ Hợp Tác (PUT), chọn lại Không đặt (PUT null)", async ({
  page,
}) => {
  const puts: unknown[] = [];
  let app: string | null = null;
  await page.route("**/admin/apps", (route) =>
    route.fulfill({
      json: {
        items: [
          { key: "chat", name: { vi: "Chat AI" }, enabled: true },
          { key: "contracts", name: { vi: "Sổ Hợp Tác" }, enabled: true },
        ],
      },
    }),
  );
  await page.route(new RegExp(`/admin/tenants/${TENANT_ID.acme}/default-app$`), (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { app: string | null };
      puts.push(body);
      app = body.app;
    }
    return route.fulfill({ json: { app } });
  });
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  const select = page.getByLabel("App mở sau khi đăng nhập");
  await expect(select).toHaveValue("");
  await select.selectOption({ label: "Sổ Hợp Tác" });
  await expect(page.getByText("Đã lưu app mặc định của")).toBeVisible();
  await expect(select).toHaveValue("contracts");
  await select.selectOption({ index: 0 });
  await expect(select).toHaveValue("");
  expect(puts).toEqual([{ app: "contracts" }, { app: null }]);
});

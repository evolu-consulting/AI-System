// dify-workflows · e2e (chỉ viết, chạy một lần cuối đợt): nút "Mở trong Dify" (link ngoài, tab mới, không lộ app-key) và tab
// "Lịch sử chạy" của workflow (platform_admin). API được stub bằng `page.route` ⇒ không cần Dify/DIFY_CONSOLE_URL thật.
import { expect, test } from "@playwright/test";
import { ID, loginAdmin, openPage, resetFixture } from "./support/helpers";

test.beforeAll(() => {
  resetFixture();
});

const CONSOLE = "https://dify.example.com/app/0b9f2c1e-1111-4222-8333-444455556666";

test("dify-workflows · menu hàng có 'Mở trong Dify' (target _blank, noopener, link /workflow) khi API trả console_url", async ({
  page,
}) => {
  await page.route(/\/admin\/workflows\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.items = body.items.map((w: Record<string, unknown>) => ({
      ...w,
      console_url: `${CONSOLE}/workflow`,
    }));
    await route.fulfill({ response: res, json: body });
  });
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflow Process");
  const row = page.getByRole("table", { name: "Workflows" }).getByRole("row").nth(1);
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  const link = page.getByRole("menuitem", { name: "Mở trong Dify" });
  await expect(link).toHaveAttribute("href", `${CONSOLE}/workflow`);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("dify-workflows · tab 'Lịch sử chạy': bảng lượt chạy (trạng thái, lỗi, mã Dify, link log), lọc trạng thái gửi status, phân trang", async ({
  page,
}) => {
  const seen: string[] = [];
  const item = (n: number, status: "ok" | "failed") => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    at: "2026-10-21T03:00:00.000Z",
    tenant: { id: "00000000-0000-4000-8000-0000000000aa", name: "Acme" },
    user: null,
    trigger: "command",
    status,
    duration_ms: 1500,
    tokens: 42,
    error_message: status === "failed" ? "HTTP 500 boom" : null,
    dify_workflow_run_id: `wr-${n}`,
    dify_conversation_id: null,
    dify_url: `${CONSOLE}/logs`,
  });
  await page.route(new RegExp(`/admin/workflows/${ID.workflow}/runs`), async (route) => {
    seen.push(route.request().url());
    await route.fulfill({
      json: { items: [item(1, "ok"), item(2, "failed")], total: 45, available: true },
    });
  });
  await loginAdmin(page);
  await page.goto(`/workflows/${ID.workflow}?tab=runs`);
  const table = page.getByRole("table", { name: "Lịch sử chạy" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("HTTP 500 boom");
  await expect(table).toContainText("wr-1");
  await expect(
    table.getByRole("link", { name: "Xem chi tiết trong Dify" }).first(),
  ).toHaveAttribute("href", `${CONSOLE}/logs`);
  await page.getByRole("combobox", { name: "Trạng thái" }).click();
  await page.getByRole("option", { name: "Lỗi" }).click();
  await expect.poll(() => seen.some((u) => u.includes("status=failed"))).toBe(true);
  await page.getByRole("button", { name: "Sau" }).click();
  await expect.poll(() => seen.some((u) => u.includes("offset=20"))).toBe(true);
});

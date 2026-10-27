// tenant-quotas: platform_admin sửa hạn mức NGÀY của công ty ở tab Quota (3 ô, trống = mặc định), thấy "hôm nay đã dùng X / Y",
// "Đặt lại hôm nay" có xác nhận. Đăng nhập + chi tiết tenant chạy admin-api THẬT; riêng `/admin/tenants/:id/daily-limits*` giả
// bằng `page.route` (hành vi API + RLS phủ ở int `apps/admin-api/src/modules/daily-limits/daily-limits.int.test.ts`).
import { expect, type Page, test } from "@playwright/test";
import { loginToShell, resetFixture, seedAdmin, TENANT_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

type Item = {
  kind: "uploads" | "actions" | "ai_tokens";
  override: number | null;
  env_default: number | null;
  effective: number | null;
  used: number | null;
  day: string;
};

/** Backend giả có trạng thái: GET, PUT (thay cả bộ), POST reset (used về 0). Ghi lại các lời gọi ghi. */
async function fakeDailyLimits(page: Page, tenantId: string) {
  const items: Item[] = [
    {
      kind: "uploads",
      override: null,
      env_default: 30,
      effective: 30,
      used: 12,
      day: "2026-10-27",
    },
    {
      kind: "actions",
      override: null,
      env_default: 100,
      effective: 100,
      used: 40,
      day: "2026-10-27",
    },
    {
      kind: "ai_tokens",
      override: null,
      env_default: 5_000_000,
      effective: 5_000_000,
      used: 1200,
      day: "2026-10-27",
    },
  ];
  const calls: string[] = [];
  const res = () => ({ tenant_id: tenantId, timezone: "Asia/Ho_Chi_Minh", items });
  const re = new RegExp(`/admin/tenants/${tenantId}/daily-limits(?:/([a-z_]+)/reset)?$`);
  await page.route(re, async (route) => {
    const req = route.request();
    const kind = re.exec(new URL(req.url()).pathname)?.[1];
    if (req.method() === "GET") return route.fulfill({ json: res() });
    if (req.method() === "PUT") {
      const body = req.postDataJSON() as Record<string, number | null>;
      calls.push(`PUT ${JSON.stringify(body)}`);
      for (const i of items) {
        i.override = body[i.kind] ?? null;
        i.effective = i.override ?? i.env_default;
      }
      return route.fulfill({ json: res() });
    }
    calls.push(`RESET ${kind}`);
    const it = items.find((i) => i.kind === kind);
    if (it) it.used = 0;
    return route.fulfill({ json: res() });
  });
  return calls;
}

test("tenant-quotas · platform_admin đặt lượt tải 50/ngày, thấy đã dùng, đặt lại hôm nay có xác nhận", async ({
  page,
}) => {
  const calls = await fakeDailyLimits(page, TENANT_ID.acme);
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await page.getByRole("tab", { name: /Quota/ }).click();
  const card = page.getByRole("region", { name: "Hạn mức theo ngày" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("daily-used-uploads")).toContainText("12");
  await expect(card.getByTestId("daily-used-uploads")).toContainText("30");

  await card.getByRole("textbox", { name: "Lượt tải hợp đồng/ngày" }).fill("50");
  await card.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText("Đã lưu hạn mức theo ngày")).toBeVisible();
  await expect(card.getByTestId("daily-used-uploads")).toContainText("50");
  expect(calls).toEqual(['PUT {"uploads":50,"actions":null,"ai_tokens":null}']);

  await card.getByRole("button", { name: "Đặt lại hôm nay: Lượt tải hợp đồng/ngày" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Đặt lại bộ đếm hôm nay?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Đặt lại hôm nay" }).click();
  await expect(page.getByText("Đã đặt lại bộ đếm hôm nay")).toBeVisible();
  await expect(card.getByTestId("daily-used-uploads")).toContainText("0 /");
  expect(calls).toEqual(['PUT {"uploads":50,"actions":null,"ai_tokens":null}', "RESET uploads"]);
});

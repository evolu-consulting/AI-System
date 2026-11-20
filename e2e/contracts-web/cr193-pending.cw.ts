// CR-193 · BR-193-9 · Sổ Hợp Tác › Đối tác: thẻ «Yêu cầu chờ duyệt» chỉ hiện 3 dòng + «Xem thêm N yêu cầu»; bấm ⇒ hiện hết, «Thu gọn» ⇒ về 3 dòng;
// không có yêu cầu ⇒ ẩn thẻ. Backend giả `page.route`; chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const link = (i: number) => ({
  tenant_id: `00000000-0000-4000-8000-00000000000${i}`,
  legal_name: `Công ty Mời ${i}`,
  tax_code: `010000000${i}`,
  verified: true,
  status: "pending_in",
  note: `Mong hợp tác ${i}`,
  invited_by_name: null,
  since: "2026-11-18T03:00:00.000Z",
});

async function open(page: Page, pendingIn: number) {
  await installV2f(page, { role: "owner" });
  await page.route("**/auth/refresh", (r) => json(r, 200, asHub("owner").grant));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  await page.route(/\/pack\/contracts\/connect\/listing$/, (r) =>
    json(r, 200, { listed: false, has_profile: true }),
  );
  await page.route(/\/pack\/contracts\/connect\/(links|settings)/, (r) => {
    const u = r.request().url();
    if (u.includes("settings")) return json(r, 200, { invite_by: "admin", can_invite: true });
    const items = u.includes("status=pending_in")
      ? Array.from({ length: pendingIn }, (_, i) => link(i + 1))
      : [];
    return json(r, 200, { items, next_cursor: null });
  });
  await page.goto("/contracts/partners");
}

test("5 yêu cầu chờ ⇒ thấy 3 + «Xem thêm 2 yêu cầu», bấm ⇒ thấy 5, «Thu gọn» ⇒ về 3", async ({
  page,
}) => {
  await open(page, 5);
  const rows = page.getByTestId("connect-request");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Xem thêm 2 yêu cầu" }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "Thu gọn" }).click();
  await expect(rows).toHaveCount(3);
});

test("không có yêu cầu nào ⇒ ẩn thẻ «Yêu cầu chờ duyệt»", async ({ page }) => {
  await open(page, 0);
  await expect(page.getByRole("region", { name: "Yêu cầu chờ duyệt" })).toBeHidden();
});

// CR-187 BR-187-5 · Sổ Hợp Tác › Đối tác: thẻ «Cho công ty khác tìm thấy công ty mình». Quản trị công ty thấy + bật được (một PUT cũ
// /admin/tenants/:id/directory); thiếu MST ⇒ khoá + lý do; thành viên thường không thấy thẻ. Backend giả `page.route`; chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const profile = (o: Record<string, unknown> = {}) => ({
  legal_name: "Công ty Acme",
  tax_code: "0312345678",
  directory_listed: false,
  directory_verified: null,
  ...o,
});

async function open(page: Page, role: "tenant_admin" | "member", p: Record<string, unknown>) {
  await installV2f(page, { role: "owner" });
  const g = asHub("owner").grant;
  await page.route("**/auth/refresh", (r) => json(r, 200, { ...g, user: { ...g.user, role } }));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  const puts: unknown[] = [];
  await page.route(/\/admin\/tenants\/[^/]+\/profile$/, (r) => json(r, 200, p));
  await page.route(/\/admin\/tenants\/[^/]+\/directory$/, (r) => {
    puts.push(r.request().postDataJSON());
    return json(r, 200, { ...p, directory_listed: true });
  });
  await page.goto("/contracts/partners");
  return puts;
}

test("quản trị công ty: bật công tắc ⇒ một PUT {listed:true}", async ({ page }) => {
  const puts = await open(page, "tenant_admin", profile());
  const sw = page.getByTestId("discoverable-switch");
  await expect(sw).toBeEnabled();
  await sw.click();
  await expect(sw).toBeChecked();
  expect(puts).toEqual([{ listed: true }]);
});

test("thiếu mã số thuế ⇒ công tắc khoá + hiện lý do", async ({ page }) => {
  await open(page, "tenant_admin", profile({ tax_code: null }));
  await expect(page.getByTestId("discoverable-switch")).toBeDisabled();
  await expect(page.getByTestId("discoverable-why")).toContainText("Mã số thuế");
});

test("thành viên thường không thấy thẻ", async ({ page }) => {
  await open(page, "member", profile());
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByTestId("discoverable-card")).toHaveCount(0);
});

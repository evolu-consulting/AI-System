// CR-187 BR-187-5 · CR-191 · Sổ Hợp Tác › Đối tác: thẻ «Cho công ty khác tìm thấy công ty mình». Người quản trị Sổ Hợp Tác (Toàn quyền) thấy + bật được
// (một PUT /pack/contracts/connect/listing); thiếu MST ⇒ khoá + lý do; vai khác thấy công tắc khoá kèm lý do. Backend giả `page.route`; chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(
  page: Page,
  role: "owner" | "editor",
  l: { listed: boolean; has_profile: boolean },
) {
  await installV2f(page, { role });
  const g = asHub(role).grant;
  await page.route("**/auth/refresh", (r) => json(r, 200, g));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  const puts: unknown[] = [];
  await page.route(/\/pack\/contracts\/connect\/listing$/, (r) => {
    if (r.request().method() === "PUT") {
      puts.push(r.request().postDataJSON());
      return json(r, 200, { ...l, listed: true });
    }
    return json(r, 200, l);
  });
  await page.route(/\/pack\/contracts\/connect\/(links|settings)/, (r) =>
    json(
      r,
      200,
      r.request().url().includes("settings")
        ? { invite_by: "admin", can_invite: role === "owner" }
        : { items: [], next_cursor: null },
    ),
  );
  await page.goto("/contracts/partners");
  return puts;
}

test("quản trị Sổ Hợp Tác: bật công tắc ⇒ một PUT {listed:true}", async ({ page }) => {
  const puts = await open(page, "owner", { listed: false, has_profile: true });
  const sw = page.getByTestId("discoverable-switch");
  await expect(sw).toBeEnabled();
  await sw.click();
  await expect(sw).toBeChecked();
  expect(puts).toEqual([{ listed: true }]);
});

test("thiếu mã số thuế ⇒ công tắc khoá + hiện lý do", async ({ page }) => {
  await open(page, "owner", { listed: false, has_profile: false });
  await expect(page.getByTestId("discoverable-switch")).toBeDisabled();
  await expect(page.getByTestId("discoverable-why")).toContainText("Mã số thuế");
});

test("vai khác (nhân viên) thấy công tắc khoá kèm lý do", async ({ page }) => {
  await open(page, "editor", { listed: false, has_profile: true });
  await expect(page.getByTestId("discoverable-switch")).toBeDisabled();
  await expect(page.getByTestId("discoverable-why")).toContainText("Chỉ quản trị công ty");
});

// CR-193 · UAT mục 4 · «Thu hồi» lời mời đã gửi hỏi lại trước khi thu hồi; «Giữ lời mời» thì không gọi API. Chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const TID = "00000000-0000-4000-8000-000000000001";
const sent = {
  tenant_id: TID,
  legal_name: "Công ty Nhận Mời",
  tax_code: "0100000001",
  verified: true,
  status: "pending_out",
  note: null,
  invited_by_name: null,
  since: "2026-11-18T03:00:00.000Z",
};

async function open(page: Page, onWithdraw: () => void) {
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
    return json(r, 200, {
      items: u.includes("status=pending_out") ? [sent] : [],
      next_cursor: null,
    });
  });
  await page.route(/\/pack\/contracts\/connect\/.*(withdraw|invite)/, (r) => {
    if (r.request().method() !== "GET") onWithdraw();
    return json(r, 200, { ok: true });
  });
  await page.goto("/contracts/partners");
}

test("Thu hồi lời mời hỏi lại, Giữ lời mời thì không gọi API", async ({ page }) => {
  let calls = 0;
  await open(page, () => calls++);
  await page.getByRole("button", { name: "Thu hồi" }).click();
  const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dlg).toContainText("Thu hồi lời mời gửi tới Công ty Nhận Mời?");
  await dlg.getByRole("button", { name: "Giữ lời mời" }).click();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Thu hồi" }).click();
  await dlg.getByRole("button", { name: "Thu hồi" }).click();
  await expect.poll(() => calls).toBe(1);
});

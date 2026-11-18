// CR-182 · R7 «Kiểm tra tệp» (/contracts/verify): khớp ⇒ câu «Khớp: Sau khi <người> ký của HĐ …» + nút «Xem bản đã ký»; không khớp ⇒ câu cảnh báo.
// Backend giả `page.route`; không sleep. (Viết trong lát, chạy cuối đợt.)
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function open(page: Page, result: unknown) {
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  await page.route("**/pack/contracts/verify-file", (r) => json(r, result));
  await page.goto("/contracts/verify");
}

test("kiểm tra tệp: khớp bản đã ký ⇒ có mã kiểm tra và nút Xem bản đã ký", async ({ page }) => {
  await open(page, {
    match: true,
    which: "signed",
    contract: { id: "c0de0000-0000-4000-8000-000000000001", title: "HĐ mua hàng A" },
    check_code: "ABCDEF12",
    signed_by: null,
    signed_at: "2026-11-01T03:00:00.000Z",
    file_id: "c0de0000-0000-4000-8000-0000000000f1",
    seq: 1,
    version_id: "c0de0000-0000-4000-8000-0000000000a1",
  });
  await page
    .getByTestId("verify-file")
    .setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
  await expect(page.getByTestId("verify-hit")).toContainText("HĐ mua hàng A");
  await expect(page.getByTestId("verify-hit")).toContainText("ABCDEF12");
  await expect(page.getByRole("link", { name: "Xem bản đã ký" })).toBeVisible();
});

test("kiểm tra tệp: không khớp ⇒ báo tệp có thể đã bị sửa", async ({ page }) => {
  await open(page, { match: false });
  await page
    .getByTestId("verify-file")
    .setInputFiles({ name: "b.pdf", mimeType: "application/pdf", buffer: Buffer.from("y") });
  await expect(page.getByTestId("verify-miss")).toContainText("Không khớp bản nào đã lưu");
});

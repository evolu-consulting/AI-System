// CR-120 · cr120-contracts-flow · khe `contracts.intake` trên UI contracts-web (backend giả `page.route`; chờ phần tử, không sleep):
//  (1) màn xác nhận (tenant tắt duyệt): nút chính «Gửi duyệt», «Lưu nháp» trong «Thao tác ▾» (CR-135 Q2), không còn dòng gợi ý draft-hint (UAT bỏ);
//  (2) [CR-127 Q10a: đã gỡ — bước "Gửi duyệt" tay của máy cũ; thay bằng e2e/cr127/j01/j14];
//  (3) HĐ nháp / không quyền xem (hub 404 "Not found") ⇒ MỘT câu chung, không lộ HĐ có tồn tại.
// VIẾT, CHƯA CHẠY trong lát (e2e chạy một lần ở cuối bằng evotest).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { REVIEW_ID } from "./dataset-v2g";
import { installV2g } from "./v2g-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const UNSEEN = "d0000000-0000-4000-8000-0000000000aa";

// CR-135 Q2: «Lưu nháp» + «Huỷ» vào menu «Thao tác ▾»; UAT (fix-uat2-quick, dc8d257f0) bỏ dòng gợi ý `draft-hint` ⇒ nút chính «Gửi duyệt» đã đủ nói bước kế.
test("màn xác nhận (tenant tắt duyệt): nút chính «Gửi duyệt», «Lưu nháp» trong «Thao tác ▾», không còn dòng gợi ý draft-hint", async ({
  page,
}) => {
  await installV2g(page);
  await page.goto(`/contracts/c/${REVIEW_ID}`);
  await expect(page.getByRole("button", { name: "Gửi duyệt" })).toBeVisible();
  await page.getByTestId("head-actions-menu").click();
  await expect(page.getByTestId("act-saveDraft")).toHaveText("Lưu nháp");
  await expect(page.getByTestId("draft-hint")).toHaveCount(0);
});

test("HĐ nháp / không quyền xem: một câu chung, không 'Not found' thô", async ({ page }) => {
  const d = asHub("editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(`**/pack/contracts/contracts/${UNSEEN}**`, (r) =>
    json(r, 404, { error: { code: "NOT_FOUND", message: "Not found" } }),
  );
  await page.goto(`/contracts/c/${UNSEEN}`);
  const box = page.getByTestId("contract-not-visible");
  await expect(box).toHaveText(
    "Hợp đồng chưa được gửi duyệt hoặc bạn không có quyền xem. Hãy nhờ người tạo xác nhận.",
  );
  await expect(page.getByText("Not found")).toHaveCount(0);
});

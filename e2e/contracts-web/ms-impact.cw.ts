// MS-impact · CR-101b · Luật 4b: banner «Pháp lý» (`legal_warning`) trên chi tiết HĐ — chỉ cảnh báo, kèm «Cần kế toán xác nhận.».
// CR-127 Q10b: hộp «Xác nhận xong» + delta uy tín «a → b» trên dòng thời gian mốc của máy cũ đã gỡ (thực hiện HĐ nay là Nhận việc /
// Giao hàng: e2e/cr127 j04). Backend giả `page.route`; chờ phần tử, không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

test("HĐ có cảnh báo pháp lý ⇒ banner chỉ cảnh báo (kèm «Cần kế toán xác nhận.»)", async ({
  page,
}) => {
  await installV2f(page, {
    contract: () => ({
      ...activeContract(),
      legal_warning: { threshold: 5_000_000, reason: "standalone_deal" },
    }),
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const legal = page.getByTestId("legal-warning");
  await expect(legal).toContainText("Pháp lý");
  await expect(legal).toContainText("Cần kế toán xác nhận.");
  await expect(legal).toContainText("5.000.000");
});

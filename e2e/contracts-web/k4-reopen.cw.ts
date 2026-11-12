// CR-101a · X5 · Luật 4b: phiên bản v2 có số điền sẵn "số gốc-SĐ1" (chưa xác minh) sửa được. (CR-127 Q10b: «Mở lại» của máy cũ đã gỡ ⇒
// phiên bản mới: e2e/cr127 j10.) Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

test("phiên bản v2 Chờ duyệt: số điền sẵn «số gốc-SĐ1» hiện ở ô Số hợp đồng và sửa được", async ({
  page,
}) => {
  const base = activeContract({ status: "needs_review" }) as { fields: Record<string, unknown> };
  await installV2f(page, {
    role: "editor",
    contract: () => ({
      ...base,
      version_no: 2,
      fields: {
        ...base.fields,
        number: { value: "HĐ-7-SĐ1", quote: "", verified: false, edited: false },
      },
    }),
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const num = page.getByLabel("Số hợp đồng");
  await expect(num).toHaveValue("HĐ-7-SĐ1");
  await expect(num).toBeEnabled();
});

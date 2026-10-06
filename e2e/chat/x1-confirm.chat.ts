/// <reference lib="dom" />
// X1-AC08 (nhánh mock) · side_effect: SSE `ask` hiện AskCard, bấm chip gửi ĐÚNG chữ của chip (plan-frontend §1.5).
// Ghi chú qc: chat-web hiển thị `ask` theo dữ liệu của mock Hub thật (chip "Họp giao ban sáng nay"/"Họp khách hàng Minh Phát"),
// vá thân SSE bằng `page.route` KHÔNG đổi được chip (đã thử, thân vá tới trình duyệt nhưng UI vẫn lấy ask của Hub).
// Vì vậy ca chip "Đồng ý"/"Huỷ" nằm ở nhánh combine (Hub thật, `e2e/combine/x1-side-effect.combine.ts`); ca này khoá hành vi
// chung: region có chip, bấm chip gửi đúng chữ, không đổi gì ở C1.
import { expect, test } from "@playwright/test";
import { login, nextSend, resetMock, sendMain } from "./_support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

test("X1-AC08 · ask: region 'Consultant cần thêm thông tin' có ≥ 2 nút lựa chọn; bấm một nút gửi đúng chữ của nút", async ({
  page,
}) => {
  await sendMain(page, "#scn:ask gửi email");
  const ask = page.getByRole("region", { name: "Consultant cần thêm thông tin" });
  await expect(ask).toBeVisible();
  const buttons = ask.getByRole("button");
  await expect(buttons).toHaveCount(2);
  const label = (await buttons.first().innerText()).trim();
  const sent = nextSend(page);
  await buttons.first().click();
  expect((await sent).content).toBe(label);
});

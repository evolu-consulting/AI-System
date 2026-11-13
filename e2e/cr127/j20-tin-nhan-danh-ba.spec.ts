// CR-132b · e2e «Tin nhắn» có cột trái «Nhóm» + «Thành viên» (chưa chạy trong lát — chạy một lần cuối đợt):
// nhân viên thấy đồng nghiệp ở «Thành viên», bấm một người chưa từng nhắn ⇒ khung chat mở ngay (không qua «Nhắn tin mới»), nhắn được.

import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

const E = envOf(SPEC_TENANT.j01);
const HELLO = `Danh bạ ${Date.now().toString(36)}`;

test("Bấm thành viên ⇒ nhắn ngay", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await loginCw(a, E, U.employee);
  await a.goto("/contracts/messages");
  await expect(a.getByRole("region", { name: "Nhóm" })).toBeVisible();
  const members = a.getByRole("region", { name: "Thành viên" });
  await expect(members).toBeVisible();
  await members.getByTestId("conv-row").first().click();
  await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();
  await ctx.close();
});

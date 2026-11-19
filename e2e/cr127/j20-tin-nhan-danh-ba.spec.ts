// CR-178 · e2e «Nhắn tin mới» (chưa chạy trong lát — chạy một lần cuối đợt): danh bạ theo phòng ban và nhóm nằm trong hộp «Nhắn tin mới»,
// tab «Công ty mình»; danh sách cuộc chỉ còn MỘT kiểu (gần đây). Nhân viên là người tạo; giám đốc (khác người tạo) nhận.

import type { Page } from "@playwright/test";
import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

const E = envOf(SPEC_TENANT.j01);
const HELLO = `Danh bạ ${Date.now().toString(36)}`;
const GROUP = `Nhóm ${Date.now().toString(36)}`;

const openNew = async (p: Page) => {
  await p.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  return p.getByTestId("new-conv-dialog");
};

test("Danh sách một kiểu; «Nhắn tin mới» chọn người theo phòng ban ⇒ chip «Tới:» ⇒ nhắn riêng", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await loginCw(a, E, U.employee);
  await a.goto("/contracts/messages");
  await expect(a.getByTestId("dept-group")).toHaveCount(0); // danh sách không còn danh bạ phòng ban
  await expect(a.getByTestId("tab-all")).toHaveAttribute("aria-pressed", "true");
  // CR-190: cột trái là danh bạ nhóm theo thứ tự cố định («Nhóm chat» rồi «Nội bộ» đứng cuối), không có tab «Đối tác ▾»
  await expect(a.getByTestId("tab-partner")).toHaveCount(0);
  await expect(a.getByTestId("dir-group").last()).toHaveAttribute("data-group", "internal");
  const dlg = await openNew(a);
  await expect(dlg.getByTestId("dept-group").first()).toBeVisible();
  await dlg.getByRole("checkbox").first().check();
  await expect(dlg.getByTestId("new-conv-chip")).toHaveCount(1);
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();
  await ctx.close();
});

test("«Nhắn tin mới»: chọn ≥ 2 người ⇒ «Tên nhóm» bắt buộc; tab «Đối tác» chọn một người, không có nhóm", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await loginCw(a, E, U.employee);
  await a.goto("/contracts/messages");
  const dlg = await openNew(a);
  await dlg.getByRole("checkbox").nth(0).check();
  await dlg.getByRole("checkbox").nth(1).check();
  await expect(dlg.getByTestId("new-conv-chip")).toHaveCount(2);
  await dlg.getByRole("button", { name: "Tạo nhóm" }).click();
  await expect(dlg.getByText("Nhập tên nhóm")).toBeVisible();
  await dlg.getByTestId("new-conv-title").fill(GROUP);
  await dlg.getByTestId("new-tab-partner").click(); // đổi tab ⇒ bỏ chọn, nhóm chỉ nội bộ
  await expect(dlg.getByTestId("new-conv-chip")).toHaveCount(0);
  await expect(dlg.getByTestId("new-conv-title")).toHaveCount(0);
  await ctx.close();
});

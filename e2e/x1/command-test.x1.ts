// X1-AC11 (e2e) · ADM-FR-23 · HUB-FR-51 · "Chạy thử" command (plan-frontend §2.2, plan-frontend-copy.md). Hub = stub 4030.
import { expect, type Page, test } from "@playwright/test";
import { collectTraffic, leaksOnPage } from "../support/helpers";
import {
  fillDraftCommand,
  hubToken,
  ID,
  loginAdmin,
  SETUP,
  setSideEffect,
  stubMode,
  stubRequests,
  testButton,
  USER_ID,
} from "./_support";

test.beforeEach(SETUP);

const input = (page: Page) => page.getByRole("textbox", { name: "Nội dung sau lệnh" });
/** Đỏ ở `expect` (chưa có Test panel) thay vì treo ở thao tác. */
async function typeText(page: Page, text: string): Promise<void> {
  await expect(input(page)).toBeVisible();
  await input(page).fill(text);
}
async function runTest(page: Page): Promise<void> {
  await expect(testButton(page)).toBeVisible();
  await testButton(page).click();
}
const isTestPost = (r: { method(): string; url(): string }) =>
  r.method() === "POST" && r.url().includes("/admin/commands/test");

test("X1-AC11 · lệnh CHƯA LƯU (form mới) chạy thử được: kết quả '… ms', tab 'Kết quả'/'Raw'/'Các bước'; Hub nhận đúng 1 lời gọi có Bearer", async ({
  page,
}) => {
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  await runTest(page);
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Kết quả" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Raw" })).toBeVisible();
  await page.getByRole("tab", { name: "Các bước" }).click();
  await expect(page.getByText("Dịch", { exact: true }).first()).toBeVisible();
  const calls = await stubRequests("/internal/test-run");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.authOk).toBe(true);
  expect(calls[0]?.body).toMatchObject({ text: "Xin chào" });
});

test("X1-AC11 · ok:false ⇒ alert 1 dòng + 'Chi tiết từ Dify' mở ra chi tiết", async ({ page }) => {
  await stubMode({ testRun: "fail" });
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  await runTest(page);
  await expect(page.getByRole("alert").filter({ hasText: "Dify trả lỗi 400" })).toBeVisible();
  await page.getByText("Chi tiết từ Dify").click();
  await expect(page.getByText("input target_lang is required")).toBeVisible();
});

test("X1-AC11 · Hub chậm: nút 'Dừng' huỷ lời gọi (Hub thấy kết nối bị huỷ)", async ({ page }) => {
  await stubMode({ testRun: "slow" });
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  await runTest(page);
  const stop = page.getByRole("button", { name: "Dừng", exact: true });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect
    .poll(async () => (await stubRequests("/internal/test-run"))[0]?.aborted ?? false, {
      timeout: 10_000,
    })
    .toBe(true);
});

test("X1-AC11 · Hub lỗi 500 ⇒ alert 'Hub không phản hồi. Kiểm tra hub-api rồi thử lại.'", async ({
  page,
}) => {
  await stubMode({ testRun: "down" });
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  await runTest(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Hub không phản hồi. Kiểm tra hub-api rồi thử lại." }),
  ).toBeVisible();
});

test("X1-AC11 · workflow side_effect: alertdialog 'Workflow này có tác dụng phụ thật…'; Huỷ = không gửi; 'Vẫn chạy' gửi lại confirm_side_effect:true", async ({
  page,
}) => {
  await setSideEffect(ID.workflow.translate, true);
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  await expect(page.getByRole("textbox", { name: "Tên command" })).toBeVisible();
  await typeText(page, "Xin chào");
  const bodies: Array<{ confirm_side_effect?: boolean }> = [];
  page.on("request", (r) => {
    if (isTestPost(r)) bodies.push(r.postDataJSON() as { confirm_side_effect?: boolean });
  });
  await runTest(page);
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText(
    "Workflow này có tác dụng phụ thật (gửi/ghi dữ liệu). Vẫn chạy thử?",
  );
  await dlg.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  expect(await stubRequests("/internal/test-run")).toHaveLength(0);
  await runTest(page);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vẫn chạy", exact: true })
    .click();
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible();
  expect(bodies.at(-1)?.confirm_side_effect).toBe(true);
  expect(await stubRequests("/internal/test-run")).toHaveLength(1);
});

test("X1-AC11 · combobox 'Chạy với tư cách user…' chọn lan ⇒ body gửi admin-api có run_as_user_id = id lan", async ({
  page,
}) => {
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  const runAs = page.getByRole("combobox", { name: "Chạy với tư cách user…" });
  await expect(runAs).toBeVisible();
  await runAs.click();
  await page.keyboard.type("lan");
  await page.getByRole("option", { name: /lan/ }).first().click();
  const req = page.waitForRequest(isTestPost);
  await runTest(page);
  expect((await req).postDataJSON()).toMatchObject({ run_as_user_id: USER_ID.lan });
});

test("X1-AC11 · không request/response/DOM/storage nào của trình duyệt chứa HUB_INTERNAL_TOKEN", async ({
  page,
}) => {
  const traffic = collectTraffic(page);
  await loginAdmin(page);
  await fillDraftCommand(page);
  await typeText(page, "Xin chào");
  await runTest(page);
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible();
  expect(hubToken()).toHaveLength(48);
  expect(await leaksOnPage(page, traffic, [hubToken()])).toEqual([]);
});

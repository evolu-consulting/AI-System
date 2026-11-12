// CR-132 · W3 · e2e hành trình «Tin nhắn» trong khoang phải + đính kèm (stack journey thật; chưa chạy trong lát — chạy một lần cuối đợt).
// A mở khoang → tab «Tin nhắn» → Nhắn tin mới → chọn B → gửi «Chào B» + 1 PDF; B (ngữ cảnh khác, đang ở trang khác) thấy chấm đỏ «1» ở nút mở khoang
// và ở tab, hội thoại in đậm ở đầu; B mở ⇒ chấm mất, A thấy «Đã xem»; B bấm thẻ tệp ⇒ tải được. Không seed sẵn hội thoại.
import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const HELLO = `Chào B khoang ${Date.now().toString(36)}`;

test("Khoang: A gửi chữ + PDF, B thấy chấm đỏ ở nút khoang và tab, mở thì hết", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await b.goto("/contracts/list"); // B ở trang khác, khoang đóng

  await a.goto("/contracts");
  await a.getByTestId("assistant-fab").click();
  await a.getByRole("tab", { name: /Tin nhắn/ }).click();
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  await a.getByTestId("composer-file-input").setInputFiles({
    name: "bao-gia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 bao gia"),
  });
  await expect(a.getByTestId("composer-files").getByText("bao-gia.pdf")).toBeVisible();
  await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();
  await expect(a.getByTestId("msg-file").filter({ hasText: "bao-gia.pdf" })).toBeVisible();

  // B: chấm đỏ «1» ở nút mở khoang; mở khoang ⇒ chấm ở tab; hội thoại in đậm ở đầu
  await expect(b.getByTestId("assistant-fab").getByTestId("unread-badge")).toHaveText("1");
  await b.getByTestId("assistant-fab").click();
  await expect(b.getByTestId("dock-tab-messages").getByTestId("unread-badge")).toHaveText("1");
  await b.getByTestId("dock-tab-messages").click();
  const first = b.getByTestId("conv-row").first();
  await expect(first).toHaveAttribute("data-unread", "true");

  // B mở hội thoại ⇒ chấm mất ở tab; A thấy «Đã xem»; ‹ về danh sách không đóng khoang
  await first.click();
  await expect(b.getByTestId("msg-file").filter({ hasText: "bao-gia.pdf" })).toBeVisible();
  await expect(b.getByTestId("dock-tab-messages").getByTestId("unread-badge")).toHaveCount(0);
  await expect(a.getByTestId("msg-seen")).toHaveText("Đã xem");
  await b.getByRole("button", { name: "Về danh sách" }).click();
  await expect(b.getByTestId("conv-list")).toBeVisible();
  await expect(b.getByTestId("dock-messages")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

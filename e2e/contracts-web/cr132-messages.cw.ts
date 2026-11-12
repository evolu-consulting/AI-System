// CR-132 · W2 · e2e hành trình «Tin nhắn» toàn màn (stack journey thật, KHÔNG giả lập; chưa chạy trong lát — chạy một lần cuối đợt):
// A (nhân viên) nhắn B (giám đốc) ⇒ B thấy số chưa đọc ở menu «Tin nhắn» và hội thoại in đậm ở đầu danh sách; B mở ⇒ số hết; A thấy «Đã xem».
// Không seed sẵn hội thoại: A tạo bằng «Nhắn tin mới». Nhãn/role giữ đúng bản UI (docs/specs/CR-132/spec.md §8).
import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const HELLO = `Chào B ${Date.now().toString(36)}`;

test("A nhắn B: B thấy chưa đọc, mở thì hết, A thấy «Đã xem»", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await b.goto("/contracts/messages"); // B đã mở app: nhận tin qua /me/stream, không cần tải lại

  // A: Nhắn tin mới → chọn B → gửi
  await a.goto("/contracts/messages");
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();

  // B: số chưa đọc ở menu + hội thoại in đậm ở đầu danh sách
  await expect(b.getByTestId("nav-contracts-messages").getByTestId("nav-badge")).toHaveText("1");
  const first = b.getByTestId("conv-row").first();
  await expect(first).toHaveAttribute("data-unread", "true");
  await expect(first.getByTestId("conv-unread")).toHaveText("1");
  await expect(first).toContainText(HELLO);

  // B mở hội thoại ⇒ chấm biến mất; A thấy «Đã xem»
  await first.click();
  await expect(b.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();
  await expect(b.getByTestId("nav-contracts-messages").getByTestId("nav-badge")).toHaveCount(0);
  await expect(b.getByTestId("conv-row").first()).toHaveAttribute("data-unread", "false");
  await expect(a.getByTestId("msg-seen")).toHaveText("Đã xem");

  await ctxA.close();
  await ctxB.close();
});

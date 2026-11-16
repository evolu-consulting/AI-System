// CR-132 · W2 · e2e hành trình «Tin nhắn» toàn màn (stack journey thật, KHÔNG giả lập; chưa chạy trong lát — chạy một lần cuối đợt):
// A (nhân viên) nhắn B (giám đốc) ⇒ B thấy số chưa đọc ở menu «Tin nhắn» và hội thoại in đậm ở đầu danh sách; B mở ⇒ số hết; A thấy «Đã xem».
// Không seed sẵn hội thoại: A tạo bằng «Nhắn tin mới». Nhãn/role giữ đúng bản UI (docs/specs/CR-132/spec.md §8).

import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

const E = envOf(SPEC_TENANT.j01);
// CR-148: cột trái là danh bạ chia nhóm theo phòng ban (không còn «hội thoại mới nhất ở đầu») ⇒ tìm dòng của A theo tên người gửi
const FROM = "E2E Nhân viên Kinh doanh";
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

  // B: số chưa đọc ở menu + dòng của A (trong nhóm phòng của A) in đậm kèm tin mới
  await expect(b.getByTestId("nav-contracts-messages").getByTestId("nav-badge")).toHaveText("1");
  const first = b.getByTestId("conv-row").filter({ hasText: FROM });
  await expect(first).toHaveAttribute("data-unread", "true");
  await expect(first.getByTestId("conv-unread")).toHaveText("1");
  await expect(first).toContainText(HELLO);
  // CR-178 · tab «Chưa đọc» (có số) chỉ giữ cuộc chưa đọc; B không phải người tạo cuộc
  await expect(b.getByTestId("tab-unread-n")).toHaveText("1");
  await b.getByTestId("tab-unread").click();
  await expect(first).toBeVisible();
  // CR-178 · A (người gửi): giờ hiện ngay dưới tin cuối của nhóm, không cần rê chuột
  await expect(a.getByTestId("msg-time").last()).toBeVisible();

  // B mở hội thoại ⇒ chấm biến mất; A thấy «Đã xem»
  await first.click();
  await expect(b.getByTestId("msg-row").filter({ hasText: HELLO })).toBeVisible();
  await expect(b.getByTestId("nav-contracts-messages").getByTestId("nav-badge")).toHaveCount(0);
  await expect(first).toHaveAttribute("data-unread", "false");
  await expect(a.getByTestId("msg-seen")).toHaveAttribute("aria-label", /Đã xem/);

  // CR-178 · «⋯»: B (người nhận) chỉ có «Sao chép», không có «Thu hồi»; A (người gửi) có cả hai
  const got = b.getByTestId("msg-row").filter({ hasText: HELLO });
  await got.hover();
  await got.getByTestId("msg-more").click();
  await expect(b.getByTestId("msg-menu").getByTestId("msg-copy")).toBeVisible();
  await expect(b.getByTestId("msg-menu").getByTestId("msg-revoke")).toHaveCount(0);
  await b.keyboard.press("Escape");
  const mine = a.getByTestId("msg-row").filter({ hasText: HELLO });
  await mine.hover();
  await mine.getByTestId("msg-more").click();
  await expect(a.getByTestId("msg-menu").getByTestId("msg-copy")).toBeVisible();
  await expect(a.getByTestId("msg-menu").getByTestId("msg-revoke")).toBeVisible();
  await a.keyboard.press("Escape");

  await ctxA.close();
  await ctxB.close();
});

// CR-178 · M2 · ô soạn: chọn emoji ⇒ chèn vào chữ; dán ảnh chụp màn hình ⇒ chip tệp; gửi ⇒ B (người nhận, khác người gửi) thấy tin có emoji (chưa chạy trong lát).
test("A chèn emoji và dán ảnh rồi gửi, B thấy", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await b.goto("/contracts/messages");

  await a.goto("/contracts/messages");
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();

  const box = a.getByRole("textbox", { name: "Nhập tin nhắn" });
  const TEXT = `Emoji ${Date.now().toString(36)}`;
  await box.fill(TEXT);
  // emoji: mở bảng, chọn ô đầu ⇒ chèn tại con trỏ (cuối chữ), bảng đóng, focus về ô soạn
  await a.getByTestId("composer-emoji").click();
  await a.getByTestId("emoji-picker").getByRole("gridcell").first().click();
  await expect(a.getByTestId("emoji-picker")).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(new RegExp(`^${TEXT}\\p{Extended_Pictographic}`, "u"));

  // dán ảnh chụp màn hình (không có chữ) ⇒ chip tệp «image.png»
  await box.evaluate((el) => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([png], "image.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await expect(a.getByRole("listitem", { name: "image.png" })).toBeVisible(); // ảnh dán hiện thumbnail (alt = tên tệp), không phải chữ
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: TEXT })).toBeVisible();

  // B (người nhận): thấy tin có emoji
  const first = b.getByTestId("conv-row").filter({ hasText: FROM });
  await first.click();
  await expect(b.getByTestId("msg-row").filter({ hasText: TEXT })).toContainText(
    /\p{Extended_Pictographic}/u,
  );

  await ctxA.close();
  await ctxB.close();
});

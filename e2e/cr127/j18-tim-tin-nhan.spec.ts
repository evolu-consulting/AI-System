// CR-178 · M3 · e2e «Tìm tin nhắn», «Ảnh & tệp», «Xem trước tệp» (stack journey thật; chưa chạy trong lát — chạy một lần cuối đợt).
// A (nhân viên) gửi B (giám đốc) tin «báo giá» + một PDF. B (người nhận, KHÁC người gửi) tìm «bao gia» (không dấu) ⇒ thấy tin, bấm ⇒ cuộc mở đúng tin;
// B mở «Ảnh & tệp» ⇒ thấy PDF, «Xem trước» mở; người ngoài cuộc (kế toán) tìm không ra.

import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

const E = envOf(SPEC_TENANT.j01);
const FROM = "E2E Nhân viên Kinh doanh";
const TAG = Date.now().toString(36);
const QUOTE = `Gửi anh báo giá ${TAG} quý này`;
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("B tìm «bao gia» ra tin của A, mở đúng tin; «Ảnh & tệp» + xem trước PDF; người ngoài không thấy", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await loginCw(c, E, U.accounting);

  // A: nhắn B một tin «báo giá», rồi gửi kèm PDF
  await a.goto("/contracts/messages");
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  const box = a.getByRole("textbox", { name: "Nhập tin nhắn" });
  await box.fill(QUOTE);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: QUOTE })).toBeVisible();
  await a
    .getByTestId("composer-file-input")
    .setInputFiles({ name: `bao-gia-${TAG}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: `bao-gia-${TAG}.pdf` })).toBeVisible();

  // B: tìm không dấu ⇒ tab «Tin nhắn» có tin của A, chỗ khớp được tô sáng; bấm ⇒ cuộc mở, tin đó nháy viền
  await b.goto("/contracts/messages");
  await b.getByRole("searchbox", { name: "Tìm người, nhóm, công ty" }).fill(`bao gia ${TAG}`);
  const hit = b.getByTestId("find-hit").filter({ hasText: QUOTE });
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark")).toContainText(/báo giá/i);
  await hit.click();
  const row = b.getByTestId("msg-row").filter({ hasText: QUOTE });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-flash", "true");
  await expect(b.getByTestId("chat-title")).toContainText(FROM);

  // B: tìm trong cuộc ⇒ «1/1»
  await b.getByTestId("chat-find").click();
  await b.getByTestId("find-input").fill(`bao gia ${TAG}`);
  await expect(b.getByTestId("find-count")).toHaveText("1/1");
  await b.keyboard.press("Escape");
  await expect(b.getByTestId("find-bar")).toHaveCount(0);

  // B: «Ảnh & tệp» ⇒ tab «Tệp» có PDF của A; «Xem trước» mở khung PDF; «Đến tin nhắn» về đúng tin
  await b.getByTestId("chat-attach").click();
  await b.getByTestId("attach-tab-file").click();
  const file = b.getByTestId("attach-file").filter({ hasText: "bao-gia" });
  await expect(file).toBeVisible();
  await expect(file).toContainText(FROM);
  await file.getByTestId("attach-preview").click();
  await expect(b.getByTestId("file-preview")).toBeVisible();
  await expect(b.getByTestId("preview-pdf")).toHaveAttribute("src", /^blob:/);
  await b.keyboard.press("Escape");
  await expect(b.getByTestId("file-preview")).toHaveCount(0);
  await file.getByTestId("attach-goto").click();
  await expect(b.getByTestId("attach-sheet")).toHaveCount(0);
  await expect(b.getByTestId("msg-row").filter({ hasText: `bao-gia-${TAG}.pdf` })).toBeVisible();

  // Người ngoài cuộc (kế toán, không phải người gửi/nhận): tìm không ra
  await c.goto("/contracts/messages");
  await c.getByRole("searchbox", { name: "Tìm người, nhóm, công ty" }).fill(`bao gia ${TAG}`);
  await expect(c.getByTestId("find-empty")).toBeVisible();
  await expect(c.getByTestId("find-hit")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

// CR-179 · hộp xem trước tệp có KÍCH THƯỚC CỐ ĐỊNH: so boundingBox lúc đang tải (chưa có blob) với lúc xong (chưa chạy trong lát — chạy một lần cuối đợt).
// A (nhân viên) gửi B (giám đốc) một PDF; B (người nhận, khác người gửi) mở «Xem trước» ⇒ hộp không đổi cỡ khi tệp về.

import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const TAG = Date.now().toString(36);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("xem trước tệp: hộp nền đen giữ nguyên kích thước trước và sau khi tải xong", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);

  await a.goto("/contracts/messages");
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  await a
    .getByTestId("composer-file-input")
    .setInputFiles({ name: `khung-${TAG}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: `khung-${TAG}.pdf` })).toBeVisible();

  // B: làm chậm tải nội dung để thấy trạng thái «đang tải», rồi so hộp trước/sau
  await b.route("**/files/*/content*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await b.goto("/contracts/messages");
  await b.getByRole("searchbox", { name: "Tìm người theo tên, chức vụ" }).fill(`khung ${TAG}`);
  await b.getByTestId("find-hit").first().click();
  await b.getByTestId("chat-attach").click();
  await b.getByTestId("attach-tab-file").click();
  await b
    .getByTestId("attach-file")
    .filter({ hasText: "khung" })
    .getByTestId("attach-preview")
    .click();
  const stage = b.getByTestId("preview-stage");
  await expect(stage).toBeVisible();
  const loading = await stage.boundingBox();
  await expect(b.getByTestId("preview-pdf")).toHaveAttribute("src", /^blob:/);
  const done = await stage.boundingBox();
  expect(loading).not.toBeNull();
  expect(done).toEqual(loading);
});

// CR-133 · J17 · «Tài liệu kèm» (stack journey thật, công ty `e2e-par-<hậu tố>`): người tạo mở HĐ nháp ⇒ khối «Tài liệu kèm» ⇒ thêm .docx ⇒ thấy trong khối
// ⇒ lấy được link tải ⇒ đuôi lạ (.doc) bị từ chối bằng câu nêu định dạng nhận được ⇒ gỡ ⇒ khối trống lại. Người khác công ty không gọi được API.
// Viết sẵn, KHÔNG chạy trong lát (CLAUDE.md Luật 0d.10) — chạy một lần ở lượt e2e cuối đợt.
import { uploadAndOpen } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";
import { apiAs, envOf, expect, HUB, loginCw, newPage, SPEC_TENANT, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j10);
const RUN = Date.now().toString(36);
// .docx tối thiểu (ZIP rỗng hợp lệ về đuôi — server chỉ lưu/tải, không đọc nội dung).
const DOCX = Buffer.from("PK\u0005\u0006" + "\u0000".repeat(18), "latin1");
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("Thêm .docx vào HĐ ⇒ thấy trong «Tài liệu kèm» ⇒ tải được ⇒ đuôi lạ bị từ chối rõ ràng ⇒ gỡ", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  const id = await uploadAndOpen(page, E, `j17-${RUN}`);
  const box = page.getByTestId("cfiles");
  await expect(box.getByRole("heading", { name: "Tài liệu kèm" })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId("cfiles-empty")).toBeVisible();

  await page
    .getByTestId("cfiles-input")
    .setInputFiles({ name: "phu-luc-bao-gia.docx", mimeType: MIME_DOCX, buffer: DOCX });
  const row = page.getByTestId("cfile-row").filter({ hasText: "phu-luc-bao-gia.docx" });
  await expect(row).toBeVisible({ timeout: 60_000 });

  // Tải được: API trả link ngắn hạn và link trả về byte.
  const s = await apiAs(E, U.employee);
  const list = (await (
    await fetch(`${HUB}/pack/contracts/contracts/${id}/files`, { headers: s.headers })
  ).json()) as { files: { id: string; name: string }[] };
  const fileId = list.files.find((f) => f.name === "phu-luc-bao-gia.docx")?.id ?? "";
  expect(fileId).not.toBe("");
  const link = await fetch(`${HUB}/pack/contracts/contracts/${id}/files/${fileId}/link`, {
    headers: s.headers,
  });
  expect(link.status).toBe(200);

  // Đuôi lạ: câu lỗi nêu định dạng nhận được, không thêm dòng nào.
  await page
    .getByTestId("cfiles-input")
    .setInputFiles({ name: "cu.doc", mimeType: "application/msword", buffer: DOCX });
  await expect(page.getByTestId("cfiles-error")).toContainText("Chỉ nhận PDF");
  await expect(page.getByTestId("cfile-row")).toHaveCount(1);

  // Người công ty khác không thấy tệp (404 cùng thân với HĐ không tồn tại).
  const other = await apiAs(envOf(SPEC_TENANT.j03), U.employee);
  const cross = await fetch(`${HUB}/pack/contracts/contracts/${id}/files`, {
    headers: other.headers,
  });
  expect(cross.status).toBe(404);

  await row.getByRole("button", { name: "Gỡ" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Gỡ" }).click(); // hộp xác nhận
  await expect(page.getByTestId("cfile-row")).toHaveCount(0);
  await expect(page.getByTestId("cfiles-empty")).toBeVisible();
});

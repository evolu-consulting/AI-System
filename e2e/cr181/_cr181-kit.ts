// CR-181 · bộ dùng chung của các spec ký trên tài liệu: HĐ PDF 6 trang có «ĐẠI DIỆN BÊN A/B», các bước theo đúng vai (sale tạo → trưởng phòng duyệt → giám đốc ký).
// Công ty do `_cr181-stack.ts` dựng (quy trình: Trưởng phòng duyệt [ý kiến + chữ ký] → Ký `ondoc`, người ký = giám đốc).
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import fontkit from "../../apps/hub-api/node_modules/@pdf-lib/fontkit";
import { PDFDocument } from "../../apps/hub-api/node_modules/pdf-lib";
import { type Env, expect, loginCw, newPage, uploadPdfAndOpen } from "../cr127/_cr127-kit";
import { stepOf } from "../journey-approval/_journey";

export const HEAD = "e2e-kd-truong";
const FONT = path.resolve(
  __dirname,
  "../../apps/hub-api/src/modules/packs/contracts/adapters/fonts/BeVietnamPro-Regular.ttf",
);

/** HĐ mẫu 6 trang (A4); trang cuối có «ĐẠI DIỆN BÊN A» và «ĐẠI DIỆN BÊN B» + «(Ký, ghi rõ họ tên)». */
export async function samplePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fs.readFileSync(FONT), { subset: false });
  for (let i = 1; i <= 6; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`HỢP ĐỒNG HỢP TÁC (e2e) · trang ${i}/6`, { x: 56, y: 790, size: 14, font });
    page.drawText(`Điều ${i}. Hai bên thống nhất thực hiện đúng, đủ, đúng hạn.`, {
      x: 56,
      y: 740,
      size: 11,
      font,
    });
    if (i === 6) {
      page.drawText("ĐẠI DIỆN BÊN A", { x: 70, y: 420, size: 12, font });
      page.drawText("ĐẠI DIỆN BÊN B", { x: 360, y: 420, size: 12, font });
      page.drawText("(Ký, ghi rõ họ tên)", { x: 78, y: 400, size: 10, font });
      page.drawText("(Ký, ghi rõ họ tên)", { x: 368, y: 400, size: 10, font });
    }
  }
  return Buffer.from(await pdf.save());
}

/** Màn «Tạo chữ ký của bạn» chắn sau đăng nhập lần đầu: gõ họ tên rồi vào app. Trả true nếu màn có hiện. */
export async function createSignatureIfAsked(page: Page, fullName: string): Promise<boolean> {
  const gate = page.getByRole("dialog", { name: "Tạo chữ ký của bạn" });
  const shown = await gate.waitFor({ state: "visible", timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  if (!shown) return false;
  await gate.getByRole("textbox", { name: "Họ tên" }).fill(fullName);
  await gate.getByRole("button", { name: "Lưu và vào Evolu" }).click();
  await expect(gate).toBeHidden();
  return true;
}

/** Sale tải HĐ PDF (còn Nháp) và đứng ở trang HĐ. Trả id. */
export async function draftSample(page: Page, e: Env, run: string): Promise<string> {
  return uploadPdfAndOpen(page, e, run, 80_000_000, await samplePdf());
}

/** Sale (đang ở trang HĐ Nháp): tệp chính «Cần ký» → «Chuẩn bị chỗ ký» → «Tự đặt theo ĐẠI DIỆN BÊN A/B» → «Lưu chỗ ký». */
export async function prepareSignPlaces(page: Page): Promise<void> {
  const files = page.getByTestId("cfiles");
  await expect(files).toBeVisible({ timeout: 30_000 });
  const first = files.getByTestId("cfile-row").first();
  const sw = first.getByRole("switch");
  await expect(sw).toBeEnabled();
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await page.getByRole("link", { name: "Chuẩn bị chỗ ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Tự đặt theo/ }).click();
  await expect(page.getByRole("status")).toContainText("Đã đặt");
  await page.getByRole("button", { name: "Lưu chỗ ký" }).click();
  await expect(page.getByTestId("sign-readiness")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Đã rõ" }).click();
}

/** Sale: chuẩn bị chỗ ký, Gửi duyệt ⇒ bước «Trưởng phòng duyệt» mở. Trả id. */
export async function saleSends(
  browser: Browser,
  e: Env,
  run: string,
  user: string,
): Promise<string> {
  const page = await newPage(browser);
  await loginCw(page, e, user);
  const id = await draftSample(page, e, run);
  await prepareSignPlaces(page);
  await page.goto(`${e.cw}/contracts/c/${id}`);
  const send = page.getByRole("button", { name: "Gửi duyệt" });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  await expect(send).toBeHidden({ timeout: 60_000 });
  await expect(stepOf(page, "Trưởng phòng duyệt")).toBeVisible({ timeout: 120_000 });
  await page.context().close();
  return id;
}

/** Vị trí giữa mép dưới trang `n` (0-based) — chuột phải ở đây đặt chữ ký trùm khe giữa trang n và n+1 (giáp lai). */
async function pageBox(page: Page, n: number) {
  const pg = page.getByTestId("sign-page").nth(n);
  await pg.scrollIntoViewIfNeeded();
  const b = await pg.boundingBox();
  if (!b) throw new Error(`không có trang ${n + 1}`);
  return b;
}

/** Chuột phải tại (fx, fy) — tỉ lệ trong trang n — rồi «Thêm chữ ký của tôi ở đây». */
export async function addMineAt(page: Page, n: number, fx: number, fy: number): Promise<void> {
  const b = await pageBox(page, n);
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, { button: "right" });
  await page.getByRole("button", { name: "Thêm chữ ký của tôi ở đây" }).click();
}

/** Bấm «Lưu» ở màn ký → hộp xác nhận → «Lưu chữ ký» → về trang HĐ. */
export async function saveSigned(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: /^Lưu/ }).first().click();
  await expect(page.getByTestId("sign-confirm")).toContainText("Sau khi lưu không sửa được");
  await page.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`), { timeout: 30_000 });
}

/** Trưởng phòng (khác người tạo): mở HĐ → Đạt → ý kiến → «Mở và ký» → một chữ ký tự do ở trang 1 → Lưu → Đạt. Bước «Trưởng phòng duyệt» thành passed. */
export async function headSignsAndPasses(browser: Browser, e: Env, id: string): Promise<void> {
  const page = await newPage(browser);
  await loginCw(page, e, HEAD);
  await page.goto(`${e.cw}/contracts/c/${id}`);
  const take = page.getByTestId("claim-take");
  if (await take.isVisible({ timeout: 15_000 }).catch(() => false)) await take.click();
  await page.locator("[data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await page.getByTestId("approver-sign").getByRole("link", { name: "Mở và ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await addMineAt(page, 0, 0.5, 0.5);
  await saveSigned(page, id);
  await page.locator("[data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await page.getByTestId("request-approve-confirm").click();
  await expect(stepOf(page, "Trưởng phòng duyệt")).toHaveAttribute("data-status", "passed", {
    timeout: 60_000,
  });
  await page.context().close();
}

/** Giám đốc (người ký công ty): bấm ô của mình ở màn ký → Lưu. */
export async function directorSigns(
  browser: Browser,
  e: Env,
  id: string,
  user: string,
): Promise<void> {
  const page = await newPage(browser);
  await loginCw(page, e, user);
  await page.goto(`${e.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await saveSigned(page, id);
  await page.context().close();
}

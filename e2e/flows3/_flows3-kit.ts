// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · bộ thao tác người dùng cho e2e quy trình thật (cùng cách `e2e/smoke-journey`, nhưng trên stack e2e): mỗi hàm = MỘT người làm MỘT việc bằng UI.
// Không sleep: chờ theo điều kiện (`reloadUntil` tải lại tới khi điều kiện đúng — việc do engine chạy nền).
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "../../apps/hub-api/node_modules/pdf-lib";
import { type Env, loginCw, stepOf, uploadAndOpen } from "../journey-approval/_journey";
import { CO, type Side } from "./_flows3-who";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.flows3.config.ts)`);
  return v;
};
export const RUN = need("FLOWS3_RUN");
export const envOf = (s: Side): Env => ({
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: CO[s].key(),
  tenantName: CO[s].name,
});

/** Phiên đăng nhập một lần cho mỗi người (giới hạn lượt đăng nhập); worker mới ⇒ bảng rỗng. */
const pages = new Map<string, Page>();
export async function as(browser: Browser, side: Side, user: string): Promise<Page> {
  const k = `${side}:${user}`;
  const old = pages.get(k);
  if (old && !old.isClosed()) return old;
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, envOf(side), user);
  pages.set(k, page);
  return page;
}

export async function reloadUntil(
  p: Page,
  check: () => Promise<void>,
  ms = 120_000,
): Promise<void> {
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await p.reload();
    await check();
  }).toPass({ timeout: ms, intervals: [2_000, 4_000, 6_000] });
}

export async function pdfOf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((l, i) => {
    page.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font });
  });
  return Buffer.from(await pdf.save());
}

/** «Gửi duyệt» (cả lần gửi lại sau Trả lại); hộp «Gắn sản phẩm» (nếu HĐ có dòng hàng) ⇒ Xác nhận. */
export async function submit(p: Page): Promise<void> {
  const btn = p.getByRole("button", { name: "Gửi duyệt" });
  await expect(btn).toBeVisible({ timeout: 60_000 });
  const gan = p.getByRole("dialog", { name: /Gắn sản phẩm/ });
  await expect(async () => {
    if (await btn.isVisible()) await btn.click({ timeout: 5_000 });
    if (await gan.isVisible())
      await gan.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await expect(btn).toBeHidden({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

/** Người tạo: tải HĐ mẫu (AI đọc xong) rồi «Gửi duyệt». Trả id HĐ. `tag` ⇒ chữ nhận ra HĐ trong danh sách (`E2E-JOURNEY-<run><tag>`). */
export async function createAndSubmit(p: Page, side: Side, tag: string): Promise<string> {
  const id = await uploadAndOpen(p, envOf(side), `${RUN}${tag}`);
  await submit(p);
  return id;
}

/** Việc dạng form ở «Việc của tôi» (đúng tên bước) ⇒ mở ⇒ `fill` ⇒ bấm gửi; chờ ô của ĐÚNG bước này biến mất. */
export async function doTask(
  p: Page,
  e: Env,
  stepName: string,
  fill?: (form: Locator) => Promise<void>,
): Promise<void> {
  await p.goto(`${e.cw}/contracts/approvals`);
  const row = p
    .getByTestId(/^(requests-waiting-row|approval-task-row)$/)
    .filter({ hasText: stepName })
    .first();
  await reloadUntil(p, async () => expect(row).toBeVisible({ timeout: 4_000 }));
  await row.click();
  const form = p.locator('form[data-flow="form"]').first();
  await expect(form).toBeVisible({ timeout: 60_000 });
  await fill?.(form);
  const own = await form.locator("[id^=flow-]").first().getAttribute("id");
  const send = form
    .locator("button[type=submit]")
    .or(form.getByRole("button", { name: "Gửi", exact: true }));
  await send.first().click();
  if (own) await expect(p.locator(`[id="${own}"]`)).toHaveCount(0, { timeout: 60_000 });
  else await expect(form).toBeHidden({ timeout: 60_000 });
}

/** «Ký (tải bản đã ký)»: trang HĐ ⇒ ô tải bản đã ký. */
export async function uploadSigned(p: Page, e: Env, id: string): Promise<void> {
  await p.goto(`${e.cw}/contracts/c/${id}`);
  const box = p.getByTestId("signed-upload-box");
  await reloadUntil(p, async () => expect(box).toBeVisible({ timeout: 4_000 }));
  await box.getByTestId("signed-upload-input").setInputFiles({
    name: `da-ky-${RUN}.pdf`,
    mimeType: "application/pdf",
    buffer: await pdfOf([`BAN DA KY ${RUN}`]),
  });
  await box.getByTestId("signed-upload-submit").click();
  await expect(p.getByTestId("signed-upload-box")).toHaveCount(0, { timeout: 60_000 });
}

/** Mở HĐ khi bước `name` đang mở cho người này (nút chính hoặc «Nhận việc» hiện). */
export async function openStep(p: Page, e: Env, id: string, name: string): Promise<void> {
  await p.goto(`${e.cw}/contracts/c/${id}`);
  const btn = p.getByTestId(/^act-(approve|pass)$/);
  const take = p.getByTestId("claim-take");
  await reloadUntil(p, async () => {
    await expect(stepOf(p, name)).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(take.or(btn).first()).toBeVisible({ timeout: 4_000 });
  });
  if (await take.isVisible()) {
    await take.click();
    await expect(p.getByTestId("claim-state")).toContainText("Bạn đang giữ");
  }
}

/** Ô bằng chứng của bước duyệt (`evidence: opinion_plus`): ý kiến BẮT BUỘC + một tệp ⇒ nút Duyệt của ô. */
async function giveEvidence(p: Page): Promise<void> {
  const ev = p.locator("[data-approval=evidence]");
  await expect(ev).toBeVisible({ timeout: 15_000 });
  await ev.locator("#evidence-note").fill(`Đồng ý (flows3 ${RUN})`);
  const files = ev.locator("#evidence-files");
  if (await files.count()) {
    await files.setInputFiles({
      name: `y-kien-${RUN}.pdf`,
      mimeType: "application/pdf",
      buffer: await pdfOf([`Y KIEN DUYET ${RUN}`]),
    });
    await expect(ev.getByTestId("evidence-file-list")).toBeVisible({ timeout: 30_000 });
  }
  await ev.getByTestId(/^request-(approve|pass)-confirm$/).click();
}

/** Người được giao duyệt: bước `name` ⇒ Duyệt (ý kiến + tệp) ⇒ bước «passed». */
export async function approveStep(p: Page, e: Env, id: string, name: string): Promise<void> {
  await openStep(p, e, id, name);
  await p.getByTestId(/^act-(approve|pass)$/).click();
  await giveEvidence(p);
  const plink = p.getByTestId("product-link-confirm");
  if (await plink.isVisible({ timeout: 3_000 }).catch(() => false)) await plink.click();
  await expect(stepOf(p, name)).toHaveAttribute("data-status", "passed", { timeout: 60_000 });
}

/** Trả lại / Từ chối: nút của bước ⇒ ô lý do (BẮT BUỘC: trống ⇒ báo lỗi, chưa gửi) ⇒ gửi. */
export async function declineStep(
  p: Page,
  e: Env,
  id: string,
  name: string,
  kind: "return" | "reject",
  reason: string,
): Promise<void> {
  await openStep(p, e, id, name);
  await p.getByRole("button", { name: "Thao tác" }).click(); // Trả lại / Từ chối nằm trong menu «Thao tác»
  await p.getByTestId(kind === "return" ? "act-return" : "act-reject").click();
  const form = p.locator("form[data-approval=reason]");
  await expect(form).toBeVisible();
  await form.locator("button[type=submit]").click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.locator("#approval-reason").fill(reason);
  await form.locator("button[type=submit]").click();
  await expect(form).toBeHidden({ timeout: 60_000 });
}

export const statusOf = (p: Page): Locator => p.getByTestId("status-chip");
export async function expectStatus(p: Page, e: Env, id: string, st: string): Promise<void> {
  await p.goto(`${e.cw}/contracts/c/${id}`);
  await reloadUntil(p, async () =>
    expect(statusOf(p).first()).toHaveAttribute("data-status", st, { timeout: 4_000 }),
  );
}

/** Người ký: «Chuẩn bị ký» (chỉ khi người tạo là cấp cao nhất) ⇒ Ký ⇒ «Nhờ đối tác ký?» = `ans`. */
export async function signAndAsk(
  p: Page,
  e: Env,
  id: string,
  ans: "Có" | "Không",
  prep: boolean,
): Promise<void> {
  if (prep) await doTask(p, e, "Chuẩn bị ký");
  await uploadSigned(p, e, id);
  await doTask(p, e, "Nhờ đối tác ký", async (form) => {
    const sel = form.locator("select").first();
    if (await sel.count()) await sel.selectOption({ label: ans });
    else await form.getByLabel(ans, { exact: true }).check();
  });
}

/** «Chọn đối tác & người nhận» ⇒ Gửi (đối tác theo MST). */
export async function pickPartner(p: Page, e: Env, tax: string, email: string): Promise<void> {
  await doTask(p, e, "Chọn đối tác", async (form) => {
    const partner = form.locator("[data-flow-field=partner_tax_code]");
    await partner.getByRole("searchbox").fill(tax);
    const opt = partner.locator("select option", { hasText: tax });
    await expect(opt, `đối tác ${tax} không có trong danh sách chọn`).toHaveCount(1, {
      timeout: 30_000,
    });
    await partner.locator("select").selectOption((await opt.getAttribute("value")) ?? "");
    await form.locator("[data-flow-field=partner_email] input").fill(email);
  });
}

/** Bên nhận mở HĐ đối tác gửi (lọc theo `tag`); lần nối đầu ⇒ bấm «Nhận» ở băng lời mời. Trả id HĐ bên nhận. */
export async function openReceived(p: Page, e: Env, tag: string): Promise<string> {
  const invite = p.getByTestId("partner-invite").first();
  const row = p
    .getByRole("row")
    .filter({ has: p.getByTestId("row-view") })
    .filter({ hasText: `E2E-JOURNEY-${RUN}${tag}` })
    .first();
  await reloadUntil(p, async () => {
    // lời mời nối lần đầu hiện ở băng đầu danh sách «Hợp đồng» (không ở bộ lọc Đối tác gửi)
    await p.goto(`${e.cw}/contracts/list`);
    if (await invite.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await invite.getByRole("button", { name: /Nhận/ }).click();
      await expect(p.getByTestId("partner-invite")).toHaveCount(0);
    }
    await p.goto(`${e.cw}/contracts/list?source=partner`);
    await expect(row).toBeVisible({ timeout: 4_000 });
  });
  await row.getByTestId("row-view").click();
  await p.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return /\/contracts\/c\/([0-9a-f-]{36})/.exec(p.url())?.[1] ?? "";
}

/** Trang HĐ đã tải xong phần nhìn thấy được: có chip trạng thái, hoặc lời báo không xem được (người ngoài cuộc). Không dùng `networkidle` (luồng sự kiện mở liên tục). */
export async function settled(p: Page): Promise<void> {
  await expect(
    statusOf(p)
      .first()
      .or(
        p
          .locator("main")
          .getByText(/quyền|không tìm thấy|không có/i)
          .first(),
      ),
  ).toBeVisible({ timeout: 45_000 });
}

// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến của runner deploy/smoke/prod-journey.ps1
// [prod-journey] · bộ thao tác người dùng cho hành trình trên môi trường ĐÃ DEPLOY (chỉ UI/URL). Chép từ e2e/flows3/_flows3-kit.ts + smoke-journey/_kit.ts,
// không import stack dựng DB local. Mật khẩu chỉ ở bộ nhớ tiến trình (PJ_PW ban đầu; mật khẩu tạm ngẫu nhiên sau lần đổi đầu), không ghi đĩa/log.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "../../apps/hub-api/node_modules/pdf-lib";
import { pickOption } from "../_kit/ui";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt — chạy qua deploy/smoke/prod-journey.ps1`);
  return v;
};
export const E = {
  cw: need("PJ_CW").replace(/\/$/, ""),
  out: process.env.PJ_OUT ?? ".data/prod-journey/shots",
};
const PW0 = need("PJ_PW");
export const RUN = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

export type Side = "n" | "e" | "p";
/** Ba công ty thật (deploy/tenants/*.yaml): mã công ty, tên pháp lý, MST. */
export const CO = {
  n: { key: "nitigroup", name: "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ NITIGROUP", tax: "0318938091" },
  e: { key: "evolu", name: "Công ty EvoluConsultants", tax: "8888888888" },
  p: { key: "preschool", name: "Công ty preschool", tax: "9999999999" },
} as const;
/** Người thật (email = tên đăng nhập). */
export const WHO = {
  n: {
    giamdoc: "thuytien.le@nitigroupvn.com",
    phogd: "thuyngan.le@nitigroupvn.com",
    kdNv: "thuyvy.trang@nitigroupvn.com", // phòng Kinh doanh KHÔNG có trưởng
    ktPho: "thuphuong.pham@nitigroupvn.com", // Kế toán (phó phòng; là người đứng đầu phòng ở yaml)
    nhanSu: "hr@nitigroupvn.com",
  },
  e: { giamdoc: "thomas.tran@evolu.com", kdTruong: "julian.bui@evolu.com" },
  p: { giamdoc: "dung.dang@preschool.com" },
} as const;

export const BTN = /^act-(approve|pass)$/;
export const stepOf = (p: Page, name: string): Locator =>
  p.getByTestId(/^approval-step-\d+$/).filter({ hasText: name });

/** Mật khẩu hiện hành theo email (sau lần đổi đầu). */
const pwOf = new Map<string, string>();
const tempPw = (): string => `Pj${randomBytes(12).toString("base64url")}9!`;

async function loginCw(page: Page, side: Side, email: string): Promise<void> {
  await page.goto(`${E.cw}/login`);
  const tenant = page.getByRole("textbox", { name: "Mã công ty" });
  const change = page.getByRole("button", { name: "Đổi công ty" });
  await expect(tenant.or(change)).toBeVisible({ timeout: 45_000 });
  if (!(await tenant.isVisible())) await change.click();
  const fill = async (pw: string): Promise<void> => {
    await tenant.fill(CO[side].key);
    await page.getByRole("textbox", { name: "Email" }).fill(email.split("@")[0] as string); // đăng nhập theo TÊN đăng nhập (phần trước @), không nhận email
    await page.getByLabel("Mật khẩu", { exact: true }).fill(pw);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  };
  const next = page.locator("input[name=next]");
  const left = (): boolean => !new URL(page.url()).pathname.startsWith("/login");
  await fill(pwOf.get(email) ?? PW0);
  await expect(async () => {
    expect((await next.isVisible()) || left(), "chờ vào app hoặc màn đổi mật khẩu").toBe(true);
  }).toPass({ timeout: 45_000 });
  if (await next.isVisible()) {
    // tài khoản mới bị ép đổi mật khẩu lần đầu ⇒ đặt mật khẩu tạm ngẫu nhiên, giữ trong bộ nhớ
    const pw = tempPw();
    await next.fill(pw);
    await page.locator("input[name=confirm]").fill(pw);
    await page.locator("form button[type=submit]").click();
    pwOf.set(email, pw);
    await expect(async () => {
      expect(left() || (await tenant.isVisible()), "sau khi đổi mật khẩu").toBe(true);
    }).toPass({ timeout: 45_000 });
    if (!left()) {
      await fill(pw); // màn đăng nhập hiện lại ⇒ đăng nhập bằng mật khẩu mới
      await expect(async () => expect(left()).toBe(true)).toPass({ timeout: 45_000 });
    }
  }
}

/** Phiên đăng nhập một lần cho mỗi người (giới hạn lượt đăng nhập). */
const pages = new Map<string, Page>();
export async function as(browser: Browser, side: Side, email: string): Promise<Page> {
  const old = pages.get(email);
  if (old && !old.isClosed()) return old;
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, side, email);
  pages.set(email, page);
  return page;
}

/** Chụp mọi phiên đang mở (người dùng thật cần thấy màn hình lúc ca kết thúc / lỗi). */
export async function shootAll(id: string): Promise<void> {
  for (const [email, p] of pages) if (!p.isClosed()) await shot(p, `${id}-${email.split("@")[0]}`);
}

async function shot(p: Page, id: string): Promise<void> {
  try {
    fs.mkdirSync(E.out, { recursive: true });
    await p.screenshot({ path: path.join(E.out, `${id}.png`), timeout: 15_000 });
  } catch {
    /* ảnh chụp là phụ */
  }
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
export const tagOf = (tag: string): string => `PJ-${RUN}${tag}`;

/** Người tạo: tải HĐ mẫu (PDF) ⇒ chờ AI đọc xong ⇒ «Gửi duyệt». Trả id HĐ. */
export async function createAndSubmit(p: Page, tag: string): Promise<string> {
  await p.goto(`${E.cw}/contracts/list`);
  await p.locator('input[type="file"]').setInputFiles({
    name: `hop-dong-${tagOf(tag)}.pdf`,
    mimeType: "application/pdf",
    buffer: await pdfOf([
      `HOP DONG MUA BAN HANG HOA ${tagOf(tag)}`,
      `So hop dong: ${tagOf(tag)}/HDMB`,
      "Ngay ky: 15/11/2026. Hieu luc 12 thang.",
      "Ben ban (Ben A): Cong ty TNHH Ben Ban Pj",
      "Ben mua (Ben B): Cong ty Mua Pj",
      "Dieu 1. Hang hoa: van phong pham theo don dat hang tung dot.",
      "Dieu 2. Tong gia tri hop dong: 11.500.000 dong (da gom VAT 10%).",
      "Dieu 3. Thanh toan 100% trong 15 ngay ke tu ngay nhan hang.",
    ]),
  });
  await p.getByTestId("upload-confirm").click();
  await p.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const id = /\/contracts\/c\/([0-9a-f-]{36})/.exec(p.url())?.[1] ?? "";
  expect(id).not.toBe("");
  const send = p.getByRole("button", { name: "Gửi duyệt" });
  await expect(send.or(p.getByTestId("manual-entry")).first()).toBeVisible({ timeout: 420_000 });
  await expect(send, "AI đọc hợp đồng lỗi (phải nhập tay)").toBeVisible();
  await expect(p.getByRole("textbox", { name: /^Tên hợp đồng/ })).not.toHaveValue("", {
    timeout: 120_000,
  });
  await expect(p.getByRole("textbox", { name: /^(Nhà cung cấp|Khách hàng)/ })).not.toHaveValue("", {
    timeout: 60_000,
  });
  // «Hiệu lực từ» AI điền kèm «chưa chắc, kiểm tra lại» ⇒ người dùng xác nhận bằng cách nhập lại ngày (không thì «Thiếu: Hiệu lực từ»).
  const from = p.getByRole("textbox", { name: /^Hiệu lực từ/ });
  await from.fill("15/11/2026");
  await from.press("Tab");
  await submit(p);
  return id;
}

/** «Gửi duyệt»; hộp «Gắn sản phẩm» (nếu có) ⇒ Xác nhận. */
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

/** Việc dạng form ở «Việc của tôi» (đúng tên bước) ⇒ mở ⇒ `fill` ⇒ bấm gửi; chờ ô của ĐÚNG bước này biến mất. */
export async function doTask(
  p: Page,
  stepName: string,
  fill?: (form: Locator) => Promise<void>,
): Promise<void> {
  await p.goto(`${E.cw}/contracts/approvals`);
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
export async function uploadSigned(p: Page, id: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
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
export async function openStep(p: Page, id: string, name: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
  const btn = p.getByTestId(BTN);
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

/** Đính một tệp vào ô bằng chứng và chờ tệp lên xong (bấm Duyệt sớm ⇒ báo thiếu bằng chứng). */
async function attach(p: Page, ev: Locator, name: string, line: string): Promise<void> {
  const files = ev.locator("#evidence-files");
  if (!(await files.count())) return;
  const uploaded = p.waitForResponse(
    (r) => r.request().method() === "POST" && /\/attachments$/.test(new URL(r.url()).pathname),
    { timeout: 30_000 },
  );
  await files.setInputFiles({ name, mimeType: "application/pdf", buffer: await pdfOf([line]) });
  expect((await uploaded).status(), "đính tệp bằng chứng").toBeLessThan(300);
  await expect(ev.getByTestId("evidence-file-list")).toBeVisible({ timeout: 30_000 });
}

/** Người được giao duyệt: bước `name` ⇒ Duyệt (ý kiến + tệp) ⇒ bước «passed». */
export async function approveStep(p: Page, id: string, name: string): Promise<void> {
  await openStep(p, id, name);
  await p.getByTestId(BTN).click();
  const ev = p.locator("[data-approval=evidence]");
  await expect(ev).toBeVisible({ timeout: 15_000 });
  await ev.locator("#evidence-note").fill(`Đồng ý (prod-journey ${RUN})`);
  await attach(p, ev, `y-kien-${RUN}.pdf`, `Y KIEN DUYET ${RUN}`);
  await ev.getByTestId(/^request-(approve|pass)-confirm$/).click();
  const plink = p.getByTestId("product-link-confirm");
  if (await plink.isVisible({ timeout: 3_000 }).catch(() => false)) await plink.click();
  await expect(stepOf(p, name)).toHaveAttribute("data-status", "passed", { timeout: 60_000 });
}

/** Trả lại / Từ chối: nút của bước ⇒ ô lý do (BẮT BUỘC) ⇒ gửi. */
export async function declineStep(
  p: Page,
  id: string,
  name: string,
  kind: "return" | "reject",
  reason: string,
): Promise<void> {
  await openStep(p, id, name);
  await p.getByRole("button", { name: "Thao tác" }).click();
  await p.getByTestId(kind === "return" ? "act-return" : "act-reject").click();
  const ev = p.locator("[data-approval=evidence]");
  const form = p.locator("form[data-approval=reason]");
  await expect(ev.or(form).first()).toBeVisible({ timeout: 15_000 });
  if (await ev.isVisible()) {
    const ok = ev.locator('[data-testid^="request-"][data-testid$="-confirm"]');
    if (await ok.isEnabled()) {
      await ok.click(); // chưa ghi ý kiến ⇒ báo, chưa gửi
      await expect(ev.getByTestId("evidence-issue")).toBeVisible();
    }
    await ev.locator("#evidence-note").fill(reason);
    await attach(p, ev, `ly-do-${RUN}.pdf`, `LY DO ${RUN}`);
    await ok.click();
    await expect(ev).toBeHidden({ timeout: 60_000 });
    return;
  }
  await form.locator("button[type=submit]").click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.locator("#approval-reason").fill(reason);
  await form.locator("button[type=submit]").click();
  await expect(form).toBeHidden({ timeout: 60_000 });
}

export const statusOf = (p: Page): Locator => p.getByTestId("status-chip");
export async function expectStatus(p: Page, id: string, st: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
  await reloadUntil(p, async () =>
    expect(statusOf(p).first()).toHaveAttribute("data-status", st, { timeout: 4_000 }),
  );
}

/** Người ký: «Chuẩn bị ký» (chỉ khi người tạo là cấp cao nhất) ⇒ Ký ⇒ «Nhờ đối tác ký?» = `ans`. */
export async function signAndAsk(
  p: Page,
  id: string,
  ans: "Có" | "Không",
  prep: boolean,
): Promise<void> {
  if (prep) await doTask(p, "Chuẩn bị ký");
  await uploadSigned(p, id);
  await doTask(p, "Nhờ đối tác ký", async (form) => {
    const sel = form.getByRole("combobox").first();
    if (await sel.count()) await pickOption(sel, { label: ans });
    else await form.getByLabel(ans, { exact: true }).check();
  });
}

/** «Chọn đối tác & người nhận» ⇒ Gửi (đối tác theo MST). */
export async function pickPartner(p: Page, tax: string, email: string): Promise<void> {
  await doTask(p, "Chọn đối tác", async (form) => {
    const partner = form.locator("[data-flow-field=partner_tax_code]");
    await partner.getByRole("searchbox").fill(tax);
    await partner.getByRole("combobox").click();
    const opt = partner.page().getByRole("option", { name: new RegExp(tax) });
    await expect(opt, `đối tác ${tax} không có trong danh sách chọn`).toHaveCount(1, {
      timeout: 30_000,
    });
    await opt.click();
    await form.locator("[data-flow-field=partner_email] input").fill(email);
  });
}

/** Bên nhận mở HĐ đối tác gửi (lọc theo `tag`); lời mời nối lần đầu (nếu còn) ⇒ «Nhận». Trả id HĐ bên nhận. */
export async function openReceived(p: Page, tag: string): Promise<string> {
  const invite = p.getByTestId("partner-invite").first();
  const row = p
    .getByRole("row")
    .filter({ has: p.getByTestId("row-view") })
    .filter({ hasText: tagOf(tag) })
    .first();
  await reloadUntil(p, async () => {
    await p.goto(`${E.cw}/contracts/list`);
    if (
      await invite.waitFor({ state: "visible", timeout: 5_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await invite.getByRole("button", { name: /Nhận/ }).click();
      await expect(p.getByTestId("partner-invite")).toHaveCount(0);
    }
    await p.goto(`${E.cw}/contracts/list?source=partner`);
    await expect(row).toBeVisible({ timeout: 4_000 });
  });
  await row.getByTestId("row-view").click();
  await p.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return /\/contracts\/c\/([0-9a-f-]{36})/.exec(p.url())?.[1] ?? "";
}

/** Trang HĐ đã tải xong phần nhìn thấy được (có chip trạng thái hoặc lời báo không xem được). */
export async function settled(p: Page): Promise<void> {
  await expect(
    statusOf(p)
      .or(p.locator("main").getByText(/không có quyền|không tìm thấy/i))
      .first(),
  ).toBeVisible({ timeout: 45_000 });
}

/** Vòng > 0 (HĐ bị trả lại về Nháp): nút chính «Gửi lại». */
export async function resubmit(p: Page): Promise<void> {
  const btn = p.getByTestId("act-resubmit");
  await expect(btn).toBeVisible({ timeout: 30_000 });
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 60_000 });
}

/** Hai công ty đã kết nối (đường «Tìm công ty» như người dùng thật). Đã kết nối ⇒ bỏ qua. Mỗi cặp một lần mỗi lượt chạy. */
const linked = new Set<string>();
export async function ensureConnected(from: Page, a: Side, to: Page, b: Side): Promise<void> {
  const k = [a, b].sort().join("");
  if (linked.has(k)) return;
  await from.goto(`${E.cw}/contracts/partners`);
  const isLinked = await from
    .getByTestId("connected-list")
    .getByText(CO[b].name)
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(
      () => true,
      () => false,
    );
  if (!isLinked) {
    await from.getByRole("button", { name: "Tìm công ty" }).click();
    const dlg = from.getByRole("dialog", { name: "Tìm công ty để kết nối" });
    await dlg.getByLabel("Tên công ty hoặc mã số thuế").fill(CO[b].tax);
    const hit = dlg.getByTestId("connect-results").getByRole("listitem").first();
    await expect(hit).toContainText(CO[b].name, { timeout: 30_000 });
    await hit.getByRole("button", { name: "Gửi lời mời kết nối" }).click();
    await from
      .getByRole("dialog", { name: /^Gửi lời mời cho/ })
      .getByRole("button", { name: "Gửi lời mời", exact: true })
      .click();
    await to.goto(`${E.cw}/contracts/partners`);
    const band = to.getByTestId("connect-request").filter({ hasText: CO[a].name });
    await reloadUntil(to, async () => expect(band).toBeVisible({ timeout: 4_000 }));
    await band.getByRole("button", { name: "Đồng ý", exact: true }).click();
    await expect(to.getByTestId("connected-list")).toContainText(CO[a].name);
  }
  linked.add(k);
}

/** Bên nhận: khối «Ký cùng lúc» ⇒ chọn người ký (nhóm «Người ký HĐ») ⇒ «Đồng ý ký cùng lúc». */
export async function agreeSignTogether(p: Page): Promise<void> {
  const btn = p.getByRole("button", { name: "Đồng ý ký cùng lúc" });
  await reloadUntil(p, async () => expect(btn).toBeVisible({ timeout: 4_000 }), 180_000);
  const pick = p.getByRole("combobox").filter({ hasText: /Chọn người ký/ });
  await pick.click();
  await expect(p.getByRole("option"), "nhóm «Người ký HĐ» không có ai để chọn").not.toHaveCount(1, {
    timeout: 15_000,
  });
  await p.getByRole("option").nth(1).click();
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 60_000 });
}

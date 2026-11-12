// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-127 · e2e hành trình · bộ dùng chung của 10 spec (`playwright.cr127.config.ts`): ánh xạ spec → công ty (do `_ja-stack.ts` dựng theo hậu tố
// `JA_D5_SUFFIX`, chưa gán quy trình/luật nào), hàm dựng tiền đề đi ĐƯỜNG THẬT (UI tải HĐ + Gửi duyệt, API mốc/nhóm/uỷ quyền của gói) — không bật sẵn
// gì trong seed (D5). Phần dựng cấu hình công ty (hồ sơ, tính năng, flow, nhóm) nằm ở `_cr127-stack.ts` (chạy một lần trước spec).
import fs from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import fontkit from "../../apps/hub-api/node_modules/@pdf-lib/fontkit";
import { PDFDocument } from "../../apps/hub-api/node_modules/pdf-lib";
import { apiLogin, type Session, tenantIdByKey } from "../_kit/api";
import { safeReload } from "../_kit/ui";
import { buyContract } from "../journey-approval/_fixture";
import {
  confirmAndSave,
  type Env,
  loginCw,
  stepOf,
  U,
  uploadAndOpen,
} from "../journey-approval/_journey";
import { pickPartnerAndSend } from "../journey-approval/_partner-pick";
import { expect } from "../journey-approval/_test";

export { type Env, expect, loginCw, U };

/**
 * Người duyệt mở HĐ, thấy bước `stepName` đang mở. Việc nhóm (CR-127 U4, `need='one'`): nút Duyệt chỉ hiện SAU khi bấm «Nhận việc»
 * (dải nhận việc nằm dưới thẻ các bước) ⇒ bấm «Nhận việc» nếu có, rồi bấm Duyệt/Đạt; bước thành «passed».
 */
export async function approveAs(
  page: Page,
  e: Env,
  user: string,
  id: string,
  stepName: string,
): Promise<void> {
  await loginCw(page, e, user);
  const isApproval = (r: Response) =>
    r.request().method() === "GET" && r.url().includes(`/contracts/${id}/approval`);
  const first = page.waitForResponse(isApproval, { timeout: 30_000 });
  await page.goto(`${e.cw}/contracts/c/${id}`);
  await first;
  const step = stepOf(page, stepName);
  const take = page.getByTestId("claim-take");
  const btn = page.locator("[data-approval=pass], [data-approval=approve]").first();
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(page, { boot: isApproval });
    await expect(step).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(take.or(btn).first()).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  if (await take.isVisible()) {
    await take.click();
    await expect(page.getByTestId("claim-state")).toContainText("Bạn đang giữ");
  }
  await btn.click();
  await expect(step).toHaveAttribute("data-status", "passed");
}

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.cr127.config.ts)`);
  return v;
};
export const SFX = need("JA_D5_SUFFIX");
export const API = need("JA_API_URL");
export const HUB = need("JA_HUB_URL");
export const PW = need("JA_USER_PW");

/** Công ty của từng spec (khoá rút gọn → `e2e-<khoá>-<hậu tố>`; mọi công ty đều do `_ja-stack.ts` dựng, 4 tài khoản như `U`). */
export const SPEC_TENANT = {
  j01: "c22",
  j03: "s2",
  j04: "ms",
  j05: "fsc",
  j06: "sub",
  j10: "par",
  j11: "s3",
  j11All: "s7a",
  /** Cặp liên công ty: [bên gửi, bên nhận]. */
  j07: ["q6a", "q6b"],
  j08: ["d5a", "d5b"],
  j13: ["c22u", "c22n"],
  /** Công ty KHÔNG có quy trình duyệt nào (Gửi duyệt bị chặn `NO_APPROVAL_FLOW`). */
  j14: "s7b",
} as const;

/** Mã số thuế của bên nhận theo cặp (khoá bên nhận → MST) — `_cr127-stack.ts` ghi vào hồ sơ công ty. */
export const TAX = {
  q6a: "0100127001",
  q6b: "0100127002",
  d5a: "0100127003",
  d5b: "0100127004",
  c22u: "0100127005",
  c22n: "0100127006",
} as const;
export const GROUP = { accounting: "kt-cr127", signers: "nguoi-ky-cr127" } as const;

export const envOf = (k: string): Env => ({
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: PW,
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-${k}-${SFX}`,
  tenantName: `E2E ${k.toUpperCase()} ${SFX}`,
});

/** Dòng HĐ của danh sách «Hợp đồng & giao dịch» (dòng có nút xem; không tính dòng trống/dòng con). */
export const contractRows = (page: Page): Locator =>
  page.getByRole("row").filter({ has: page.getByTestId("row-view") });

export const newPage = async (browser: Browser, w = 1440): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: w, height: 900 } })).newPage();

/** Phiên API của người dùng một công ty (app contracts ⇒ gọi được `/pack/contracts/*` của hub). */
export const apiAs = (e: Env, user: string, app = "contracts"): Promise<Session> =>
  apiLogin({ base: API, tenantKey: e.tenantKey, username: user, password: PW, app });

export async function tenantIdOf(e: Env): Promise<string> {
  const s = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: e.adminUser,
    password: e.adminPw,
  });
  return tenantIdByKey(API, s, e.tenantKey);
}

const packCall = async (
  s: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const r = await fetch(`${HUB}/pack/contracts${path}`, {
    method,
    headers: { ...s.headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
};

const FONT = path.resolve(
  __dirname,
  "../../apps/hub-api/src/modules/packs/contracts/adapters/fonts/BeVietnamPro-Regular.ttf",
);

/** PDF THẬT có lớp chữ (font Be Vietnam Pro nhúng ⇒ tiếng Việt có dấu trích lại được): mỗi dòng văn bản một dòng chữ, 55 dòng/trang. */
export async function textPdf(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fs.readFileSync(FONT), { subset: false });
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 55) {
    const page = pdf.addPage([595, 842]);
    lines.slice(i, i + 55).forEach((l, k) => {
      page.drawText(l.replace(/^#+ /, ""), { x: 40, y: 800 - k * 14, size: 9, font });
    });
  }
  return Buffer.from(await pdf.save());
}

/**
 * Như `uploadAndOpen` nhưng tệp là PDF có lớp chữ thật (`textPdf` của văn bản mẫu): phiên ký chung (BR-60) chỉ lập khi tệp HĐ là PDF (`fileShaOf`), HĐ .md ⇒ gửi thường.
 */
async function uploadPdfAndOpen(page: Page, e: Env, run: string, total: number): Promise<string> {
  const doc = buyContract(run, total);
  await page.goto(`${e.cw}/contracts/list`);
  await page.locator('input[type="file"]').setInputFiles({
    name: `hop-dong-mua-${run}.pdf`,
    mimeType: "application/pdf",
    buffer: await textPdf(doc.text),
  });
  await page.getByTestId("upload-confirm").click();
  await page.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const id = /\/contracts\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  expect(id).not.toBe("");
  await expect(page.getByRole("textbox", { name: /^Tên hợp đồng/ })).not.toHaveValue("", {
    timeout: 120_000,
  });
  await expect(page.getByRole("textbox", { name: /^Nhà cung cấp/ })).not.toHaveValue("", {
    timeout: 60_000,
  });
  return id;
}

/** Nhân viên tải HĐ mẫu + «Gửi duyệt» (công ty PHẢI có quy trình duyệt — `_cr127-stack.ts`): HĐ vào bước duyệt. Trả id HĐ. */
export async function submitContract(
  browser: Browser,
  e: Env,
  run: string,
  total?: number,
  /** Việc làm khi HĐ còn DRAFT (sau khi AI đọc xong, trước «Gửi duyệt») — vd lập mốc: HĐ đã vào duyệt/DONE thì mốc khoá (BR-39, `CONTRACT_LOCKED`). */
  beforeSend?: (id: string) => Promise<void>,
  /** Tệp HĐ là PDF (cần cho phiên ký chung). */
  pdf = false,
): Promise<string> {
  const emp = await newPage(browser);
  await loginCw(emp, e, U.employee);
  const id = pdf
    ? await uploadPdfAndOpen(emp, e, run, total ?? 11_500_000)
    : await uploadAndOpen(emp, e, run, total);
  await beforeSend?.(id);
  await confirmAndSave(emp);
  await emp.context().close();
  return id;
}

/** HĐ DONE (công ty có quy trình «Giám đốc duyệt»: nhân viên Gửi duyệt → Giám đốc duyệt xong) + hai mốc: «Giao» 650 thùng (hạn 2026-11-20) và «Thu» (hạn 2026-12-10). Trả id HĐ. */
export async function doneContractWithMilestones(
  browser: Browser,
  e: Env,
  run: string,
  o: {
    /** SL chung của mốc Giao (`null` = không đặt: HĐ mẫu không có dòng hàng, server chỉ nhận SL chung khi HĐ có đúng một dòng — `DELIVERY_INVALID`). */
    deliveryQty?: number | null;
    /** Bên làm mốc Thu (đối tác trả tiền ⇒ `partner`: phạt chậm áp cho điều khoản của đối tác). */
    collectOwner?: "ours" | "partner";
  } = {},
): Promise<string> {
  const deliveryQty = o.deliveryQty === undefined ? 650 : o.deliveryQty;
  const s = await apiAs(e, U.employee);
  // mốc lập khi HĐ còn DRAFT (DONE rồi thì mốc khoá); tên riêng «… đợt 1» để spec không lẫn với mốc AI đọc từ văn bản
  const id = await submitContract(browser, e, run, undefined, async (cid) => {
    await packCall(s, "POST", `/contracts/${cid}/milestones`, {
      kind: "delivery",
      title: "Giao đợt 1",
      due_date: "2026-11-20",
      owner: "ours",
      ...(deliveryQty === null ? {} : { qty: deliveryQty }),
    });
    await packCall(s, "POST", `/contracts/${cid}/milestones`, {
      kind: "collect",
      title: "Thu đợt 1",
      due_date: "2026-12-10",
      owner: o.collectOwner ?? "ours",
      amount: 5_000_000,
    });
  });
  await approveAs(await newPage(browser), e, U.director, id, "Giám đốc duyệt");
  await expect
    .poll(
      async () => ((await packCall(s, "GET", `/contracts/${id}`)) as { status?: string }).status,
      {
        timeout: 60_000,
      },
    )
    .toBe("done");
  return id;
}

/** Bên gửi A: tải HĐ → Gửi duyệt → Giám đốc duyệt → Giám đốc chọn đối tác B + email → «Gửi» (flow gửi đối tác do `_cr127-stack.ts` dựng). Trả id HĐ. */
export async function sendFromA(
  browser: Browser,
  a: Env,
  bKey: keyof typeof TAX,
  run: string,
  pdf = false,
): Promise<string> {
  const id = await submitContract(browser, a, run, 600_000_000, undefined, pdf);
  const emp = await newPage(browser);
  await loginCw(emp, a, U.employee);
  await emp.goto(`${a.cw}/contracts/c/${id}`);
  await expect(stepOf(emp, "Giám đốc duyệt")).toBeVisible({ timeout: 120_000 });
  await emp.context().close();
  await approveAs(await newPage(browser), a, U.director, id, "Giám đốc duyệt");
  await pickPartnerAndSend(await newPage(browser), a, U.director, {
    partnerTaxCode: TAX[bKey],
    email: `chon-${run}@doitac.test`,
    contractCreator: U.employee,
    partnerAddedBy: U.accounting, // G3: người chọn (giám đốc) ≠ người tạo HĐ ≠ người thêm đối tác
  });
  return id;
}

/** Bên nhận B nhận lời mời nối lần đầu (băng ở đầu danh sách Hợp đồng) ⇒ lần gửi bị giữ được thả. */
export async function acceptInvite(browser: Browser, b: Env): Promise<void> {
  const page = await newPage(browser);
  await loginCw(page, b, U.director);
  await page.goto(`${b.cw}/contracts/list`);
  const invite = page.getByTestId("partner-invite").first();
  await expect(invite).toBeVisible({ timeout: 120_000 });
  await invite.getByRole("button", { name: /Nhận/ }).click();
  await expect(page.getByTestId("partner-invite")).toHaveCount(0);
  await page.context().close();
}

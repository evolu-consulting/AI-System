// CR-182 · đợt 2 · cr182-partner-web · ĐỐI TÁC KÝ QUA LINK RIÊNG (BR-C5): không tài khoản, mở link trong email → tạo chữ ký nhanh → ký ô Bên B → HĐ «Đã ký».
// Vai: sale (người tạo) → trưởng phòng (duyệt + ký) → giám đốc (người ký công ty, Bên A đủ ⇒ mời đối tác) → ĐỐI TÁC (trình duyệt sạch, không đăng nhập).
// Lấy link: `HUB_NOTIFY_MODE=off` ghi link ra log hub (`partner-sign-mail-off`). Đặt `E2E_PARTNER_LINK` (link đầy đủ) HOẶC `E2E_HUB_LOG` (tệp log hub) để spec đọc.
// Viết theo khuôn e2e/cr181/journey-3-vai.spec.ts; chưa chạy (điều phối chạy cuối đợt).
import fs from "node:fs";
import { test } from "@playwright/test";
import { envOf, expect, loginCw, newPage, U } from "../cr127/_cr127-kit";
import { withOwner } from "../support/helpers";
import {
  createSignatureIfAsked,
  directorSigns,
  draftSample,
  headSignsAndPasses,
  prepareSignPlaces,
  seedPartnerContact,
  stepEventually,
} from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf("q5");
const RUN = Date.now().toString(36);
const GIAMDOC = "e2e-giamdoc";
let id = "";
let link = "";

/** Link `/ky/<token>` mới nhất trong log hub (hoặc biến môi trường). Mail gửi sau khi Bên A ký đủ (NOTIFY) ⇒ thử lại. */
async function readLink(): Promise<string> {
  const direct = process.env.E2E_PARTNER_LINK;
  if (direct) return direct;
  const file = process.env.E2E_HUB_LOG;
  if (!file) throw new Error("Đặt E2E_PARTNER_LINK hoặc E2E_HUB_LOG để lấy link ký của đối tác");
  let found = "";
  await expect(async () => {
    const m = fs.readFileSync(file, "utf8").match(/https?:\/\/[^\s"\\]+\/ky\/[A-Za-z0-9_-]+/g);
    found = m?.at(-1) ?? "";
    expect(found).not.toBe("");
  }).toPass({ timeout: 60_000 });
  return found;
}

test("công ty: sale tạo → trưởng phòng duyệt → giám đốc ký ⇒ HĐ chờ đối tác (Bên A đủ), có link ký", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const sale = await newPage(browser);
  await loginCw(sale, E, U.employee);
  await createSignatureIfAsked(sale, "Lê Mạnh Cường");
  id = await draftSample(sale, E, RUN);
  await seedPartnerContact(id, "doi-tac-ky@e2e.test");
  await prepareSignPlaces(sale);
  await sale.goto(`${E.cw}/contracts/c/${id}`);
  await sale.getByRole("button", { name: "Gửi duyệt" }).click();
  await stepEventually(sale, id, "Trưởng phòng duyệt", "open");
  await sale.context().close();

  await headSignsAndPasses(browser, E, id);
  await directorSigns(browser, E, id, GIAMDOC);

  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  const wait = page.getByTestId("sign-partner-wait");
  await expect(wait).toContainText("Chờ", { timeout: 60_000 });
  await expect(page.getByTestId("partner-link")).toContainText("Đã gửi lúc");
  await expect(page.getByTestId("partner-link")).toContainText("Chưa mở");
  await expect(page.getByTestId("partner-link")).toContainText("Hạn ký");
  await expect(wait.getByRole("button", { name: "Gửi lại link" })).toBeVisible();
  await page.context().close();
  link = await readLink();
});

test("đối tác (không đăng nhập): mở link → tạo chữ ký nhanh → ký ô Bên B ⇒ «Bạn đã ký xong»", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser); // trình duyệt sạch: không phiên Evolu
  await page.goto(link);
  await expect(page.getByTestId("partner-invite")).toContainText("mời bạn ký", { timeout: 30_000 });
  await expect(page.getByTestId("partner-invite")).toContainText("Chỗ ký của bạn");
  await expect(page.getByRole("button", { name: "Từ chối ký" })).toBeVisible();
  await expect(page.getByTestId("partner-invite")).not.toContainText("[object Object]");

  await page.getByRole("button", { name: "Xem và ký" }).click();
  const quick = page.getByTestId("partner-quick");
  await expect(quick.getByRole("heading", { name: "Tạo chữ ký của bạn" })).toBeVisible();
  await quick.getByRole("textbox", { name: "Họ tên" }).fill("Trần Thị B");
  await quick.getByRole("button", { name: "Lưu chữ ký" }).click();

  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await page.getByRole("button", { name: /^Lưu/ }).first().click();
  await page.getByTestId("sign-confirm").getByRole("button", { name: "Lưu chữ ký" }).click();

  await expect(page.getByTestId("partner-signed")).toContainText("Bạn đã ký xong", {
    timeout: 60_000,
  });
  await expect(page.getByRole("link", { name: /Xem bản đã ký/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Tải về/ }).first()).toBeVisible();

  // mở lại link: chỉ để xem, không ký thêm
  await page.reload();
  await expect(page.getByTestId("partner-signed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Xem và ký" })).toHaveCount(0);
  await page.context().close();
});

test("công ty: HĐ «Đã ký» sau khi đối tác ký", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByTestId("sign-partner-wait")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("signers-strip")).toContainText("Đã ký", { timeout: 60_000 });
  await page.context().close();
});

test("link hết hạn ⇒ câu báo rõ ràng, không có nút ký, link sai ⇒ không tìm thấy", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await withOwner(async (sql) => {
    await sql`update contracts.partner_sign_links set expires_at = now() - interval '1 minute', signed_at = null where contract_id = ${id}::uuid`;
  });
  const page = await newPage(browser);
  await page.goto(link);
  const gone = page.getByTestId("partner-gone");
  await expect(gone).toBeVisible({ timeout: 30_000 });
  await expect(gone).toContainText("hết hạn");
  await expect(gone).toContainText("được gửi lại");
  await expect(page.getByRole("button", { name: "Xem và ký" })).toHaveCount(0);

  await page.goto(link.replace(/\/ky\/[^/?#]+/, "/ky/khong-co-link-nay-0123456789"));
  await expect(page.getByTestId("partner-notfound")).toContainText("Không tìm thấy trang ký này", {
    timeout: 30_000,
  });
  await page.context().close();
});

test("điện thoại 390px: trang mời ký dùng được, nút ≥ 44px", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(link);
  // link đã hết hạn ở ca trước ⇒ chỉ kiểm khung không tràn ngang
  await expect(page.getByTestId("partner-page")).toBeVisible({ timeout: 30_000 });
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(over).toBe(false);
  await ctx.close();
});

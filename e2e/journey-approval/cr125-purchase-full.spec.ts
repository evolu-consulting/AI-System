// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-purchase-parent · HÀNH TRÌNH THẬT «Quy trình mua hàng» từ đầu đến cuối (stack `playwright.journey.config.ts`, công ty
// `e2e-ms-<hậu tố>`): nhân viên mở «Tạo yêu cầu» → điền phiếu «Đề xuất mua hàng» (tải file báo giá) → Phần 1 (bước điền + duyệt, dòng 3 hai
// nhóm CÙNG duyệt) → Phần 2 (dòng 6 ba nhóm cùng duyệt, Giám đốc, Ký số «Ký thử») → Phần 3 (dòng 10 cùng duyệt, thanh toán) → yêu cầu cha
// «Đã xong». Cấu hình công ty đi đúng đường seed của sản phẩm (`writeCr125Config`: nhóm, mẫu Thư viện, flow «Quy trình mua hàng» đã gán);
// chuẩn bị bằng SQL chỉ phần người dùng thật làm ở màn thành viên nhóm (gán 3 tài khoản e2e vào các nhóm duyệt).
// Bước điền (form) của Phần 1–3: qua thẻ bước điền khi lát cr125-form-step-card đã gộp (`form-step-card`); chưa gộp thì kịch bản dừng ở
// đó với lý do rõ (không giả lập). KHÔNG chạy trong lát này — chạy MỘT lần ở đợt cuối.
import { expect, type Page, test } from "@playwright/test";
import { writeCr125Config } from "../../apps/hub-api/src/modules/seed/seed.cr125-config";
import { withOwner } from "../support/helpers";
import { type Env, loginCw, U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-ms-${SFX}`,
  tenantName: `E2E MS ${SFX}`,
};
const FLOW = "Quy trình mua hàng";
const SHOTS = "docs/specs/cr125-purchase-parent";
const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
};
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();

/** Nhóm duyệt của mẫu → tài khoản e2e (mỗi dòng cùng duyệt có ít nhất hai người khác nhau). */
const MEMBERS: Record<string, string[]> = {
  [U.director]: [
    "nhan-vien-phong-ban",
    "truong-bo-phan",
    "mua-hang",
    "truong-mua-hang",
    "phap-che",
    "giam-doc",
    "kho",
  ],
  [U.accounting]: ["tai-chinh", "ke-toan", "ke-toan-truong", "thu-quy"],
  [U.employee]: ["nhan-vien-phong-ban"],
};

let runUrl = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await withOwner(async (sql) => {
    await sql.begin((tx) => writeCr125Config(tx as never, [E.tenantKey]));
    const rows = Object.entries(MEMBERS).flatMap(([user, groups]) =>
      groups.map((group) => ({ user, group })),
    );
    await sql`insert into admin.group_members (tenant_id, group_id, user_id)
      select tn.id, g.id, u.id
      from admin.tenants tn
      cross join jsonb_to_recordset(${sql.json(rows as never)}::jsonb) as x("user" text, "group" text)
      join admin.groups g on g.tenant_id = tn.id and g.key = x."group"
      join admin.users u on u.tenant_id = tn.id and u.username = x."user"
      where tn.key = ${E.tenantKey}
      on conflict do nothing`;
  });
});

/** Người duyệt bấm «Đạt» mọi thẻ đang mở của mình trên yêu cầu `runUrl`; trả true nếu bấm được ít nhất một thẻ. */
async function approveOpenCards(page: Page): Promise<boolean> {
  await page.goto(runUrl);
  await expect(page.getByTestId("request-page")).toBeVisible({ timeout: 60_000 });
  let acted = false;
  for (let guard = 0; guard < 4; guard++) {
    const btn = page.getByTestId("request-approve");
    if (!(await btn.first().isVisible())) break;
    await btn.first().click();
    acted = true;
    await expect(btn.first())
      .toBeHidden({ timeout: 30_000 })
      .catch(() => undefined);
  }
  return acted;
}

/** Bước điền qua thẻ bước điền (lát cr125-form-step-card): điền ô còn trống bằng giá trị mẫu rồi gửi. */
async function fillFormCards(page: Page): Promise<boolean> {
  const card = page.getByTestId("form-step-card").first();
  if (!(await card.isVisible())) return false;
  for (const input of await card.locator("input[type=text]:visible, textarea:visible").all())
    if ((await input.inputValue()) === "") await input.fill("Dữ liệu e2e");
  await card.getByTestId("form-step-submit").click();
  await expect(card).toBeHidden({ timeout: 30_000 });
  return true;
}

test("1 · nhân viên: Tạo yêu cầu → phiếu «Đề xuất mua hàng» (tải file báo giá) → gửi", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  await emp.getByTestId("nav-contracts-requests").click();
  const item = emp.getByTestId("startable-flow").filter({ hasText: FLOW });
  await expect(item).toBeVisible({ timeout: 60_000 }); // mọi người trong công ty được bắt đầu
  await item.click();
  await emp.getByLabel("Tên hàng").fill("Máy in HP LaserJet");
  await emp.getByLabel("Số lượng").fill("3");
  await emp.getByLabel("Giá dự kiến").fill("12500000");
  await emp.getByLabel("Lý do").fill("Thay máy in cũ của phòng Kinh doanh");
  await emp.getByTestId("req-file-file_bao_gia").setInputFiles({
    name: "bao-gia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await expect(emp.getByTestId("req-file-item")).toContainText("bao-gia.pdf");
  await shot(emp, "01-phieu-de-xuat-mua-hang");
  await emp.getByTestId("request-submit").click();
  await expect(emp.getByTestId("request-page")).toBeVisible({ timeout: 60_000 });
  runUrl = emp.url().split("?")[0] ?? "";
  await expect(emp.getByTestId("request-field-ten_hang")).toContainText("Máy in HP LaserJet");
});

test("2 · Phần 1 → 2 → 3: các thẻ điền / duyệt (dòng 3, 6, 10 hai–ba nhóm cùng duyệt, Giám đốc Ký thử) tới khi yêu cầu cha «Đã xong»", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const boss = await ctxPage(browser);
  await loginCw(boss, E, U.director);
  const acc = await ctxPage(browser);
  await loginCw(acc, E, U.accounting);

  const status = emp.getByTestId("request-status");
  let shots = 0;
  for (let round = 0; round < 60; round++) {
    await emp.goto(runUrl);
    if ((await status.getAttribute("data-status")) === "done") break;
    // dòng cùng duyệt: cả hai bên đều có thẻ mở ⇒ mỗi bên bấm Đạt phần của mình
    const moved = [
      await fillFormCards(emp),
      await fillFormCards(boss),
      await approveOpenCards(boss),
      await fillFormCards(acc),
      await approveOpenCards(acc),
    ].some(Boolean);
    if (moved && shots < 6) await shot(boss, `02-buoc-${++shots}`);
    if (!moved) await emp.waitForTimeout(2_000); // chờ lượt con / hẹn canh chốt bước cha (tín hiệu server, không có sự kiện UI)
  }
  await emp.goto(runUrl);
  await expect(status).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await shot(emp, "03-quy-trinh-mua-hang-da-xong");
});

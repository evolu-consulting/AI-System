// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-form-step-card · HÀNH TRÌNH THẬT «Quy trình mua hàng · Phần 1» (đúng các bước của mẫu Thư viện đã seed) chạy TRỌN trên giao diện,
// KHÔNG gửi form bằng API: nhân viên điền «Đề xuất» + đính kèm tệp ⇒ Trưởng bộ phận duyệt ⇒ Mua hàng điền báo giá + tệp ⇒ … ⇒ «Tạo PO» + tệp ⇒
// Trưởng bộ phận duyệt PO ⇒ Kết thúc. Kiểm: bước form KHÔNG có Duyệt/Trả lại/Từ chối ở đầu trang, giá trị + tên tệp đã gửi hiện chỉ đọc ở thẻ
// của người sau, người ngoài nhóm không thấy ô nhập. Công ty MỚI `e2e-fsc-<hậu tố>`; nhóm theo MÃ của mẫu dựng bằng SQL (cài đặt), mẫu gán bằng UI.
import { expect, type Page, test } from "@playwright/test";
import { PURCHASE_TEMPLATES } from "../../apps/hub-api/src/modules/processes/library/purchase-templates";
import { apiLogin } from "../_kit/api";
import { createLibraryFlow, enableFlowTriggers } from "../_kit/flows";
import {
  assignFlowUi,
  loginPlatformAdminUi,
  openCompanyFlows,
  openTenantPage,
  safeReload,
} from "../_kit/ui";
import { withOwner } from "../support/helpers";
import { approveAs, confirmAndSave, type Env, loginCw, stepOf, U, uploadAndOpen } from "./_journey";

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
  tenantKey: `e2e-fsc-${SFX}`,
  tenantName: `E2E FSC ${SFX}`,
};
const P1 = PURCHASE_TEMPLATES[0] as (typeof PURCHASE_TEMPLATES)[number];
const FLOW = `Mua hàng · Phần 1 ${SFX}`;
const TRUONG_BP = "e2e-kd-truong";
/** Nhóm theo MÃ của mẫu → người của công ty hành trình (một người có thể giữ nhiều nhóm). */
const GROUP_MEMBERS: Record<string, string> = {
  "nhan-vien-phong-ban": U.employee,
  "truong-bo-phan": TRUONG_BP,
  "mua-hang": U.accounting,
  "truong-mua-hang": U.director,
  "tai-chinh": U.director,
  "giam-doc": U.director,
};
const stageKey = (i: number): string => (P1.stages[i] as { key: string }).key;
const stageName = (i: number): string => (P1.stages[i] as { name: string }).name;
/** Một nhóm của dòng «cùng duyệt»: người của nhóm bấm Duyệt phần mình; chưa phải nhóm cuối ⇒ bước vẫn mở, nút Duyệt của người này biến mất. */
async function approvePart(
  page: Page,
  user: string,
  id: string,
  stepName: string,
  last: boolean,
): Promise<void> {
  if (last) return approveAs(page, E, user, id, stepName);
  await loginCw(page, E, user);
  const isApproval = (r: import("@playwright/test").Response) =>
    r.request().method() === "GET" && r.url().includes(`/contracts/${id}/approval`);
  const first = page.waitForResponse(isApproval, { timeout: 30_000 });
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await first;
  const btn = page.locator("[data-approval=pass], [data-approval=approve]").first();
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(page, { boot: isApproval });
    await expect(stepOf(page, stepName)).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(btn).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  await btn.click();
  await expect(btn).toHaveCount(0, { timeout: 30_000 });
  await expect(stepOf(page, stepName)).toHaveAttribute("data-status", "open");
}
const FILE_BODY = Buffer.from("hang,so_luong\nmay chu,2\n", "utf8");

const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 900 } })).newPage();

/** Người của nhóm làm mở thẻ, thấy ĐÚNG bước form `i` đang mở, điền ô + đính kèm tệp rồi «Gửi»; bước thành «Đã điền» và hiện giá trị chỉ đọc. */
async function fillFormAs(
  page: Page,
  user: string,
  id: string,
  i: number,
  o: { values: Record<string, string>; files: Record<string, string> },
  shot?: string,
): Promise<void> {
  await loginCw(page, E, user);
  const isApproval = (r: import("@playwright/test").Response) =>
    r.request().method() === "GET" && r.url().includes(`/contracts/${id}/approval`);
  const first = page.waitForResponse(isApproval, { timeout: 30_000 });
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await first;
  const row = page.getByTestId(`flow-step-${stageKey(i)}`);
  const form = row.locator('form[data-flow="form"]');
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(page, { boot: isApproval });
    await expect(row).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(form).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 90_000 });
  // bước form: KHÔNG có nút Duyệt / Trả lại / Từ chối ở đầu trang
  await expect(
    page.locator("[data-approval=pass], [data-approval=return], [data-approval=reject]"),
  ).toHaveCount(0);
  const field = (k: string) => form.locator(`[data-flow-field="${k}"]`);
  for (const [k, v] of Object.entries(o.values))
    await field(k).locator("input, textarea").first().fill(v);
  for (const [k, name] of Object.entries(o.files)) {
    await field(k).locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: FILE_BODY,
    });
    await expect(field(k).getByTestId("file-item")).toContainText(name, { timeout: 30_000 });
  }
  if (shot) await row.screenshot({ path: shot });
  await form.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "passed", { timeout: 60_000 });
  await expect(form).toHaveCount(0);
  await expect(row).toContainText("Đã điền");
  // tiền hiện «480.000.000 ₫» (vi-VN), còn lại hiện nguyên chữ
  for (const v of Object.values(o.values))
    await expect(row).toContainText(/^\d{6,}$/.test(v) ? Number(v).toLocaleString("vi-VN") : v);
  for (const name of Object.values(o.files)) await expect(row).toContainText(name);
}

test("Phần 1 «Mua hàng»: mọi bước điền thông tin + đính kèm tệp làm trên giao diện, tới Kết thúc", async ({
  browser,
}, testInfo) => {
  test.setTimeout(900_000);
  // — cài đặt (không phải đường nghiệp vụ): mẫu Phần 1 dạng Thư viện, nhóm theo MÃ của mẫu + thành viên, cờ flow theo sự kiện —
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  await createLibraryFlow(need("JA_HUB_URL"), platform.token, {
    key: `fsc-p1-${SFX}`,
    name: FLOW,
    app: "contracts",
    // Mẫu Phần 1 của «Quy trình mua hàng» giờ là lượt con (NEVER_TRIGGER: điều kiện không bao giờ đúng, đầu vào = phiếu). Spec này chạy nó như quy
    // trình theo sự kiện HĐ (thẻ HĐ): đặt lại «Bắt đầu khi» = khi gửi duyệt HĐ, đầu vào = mã HĐ.
    trigger: { event: "contract.submitted" },
    inputs: [{ key: "contract_id", type: "text", label: "Hợp đồng", required: false }],
    stages: P1.stages as unknown as Record<string, unknown>[],
  });
  const tenantId = await enableFlowTriggers(E.tenantKey);
  await withOwner(async (sql) => {
    for (const [group, user] of Object.entries(GROUP_MEMBERS)) {
      await sql`insert into admin.groups (tenant_id, key, name, description)
        values (${tenantId}::uuid, ${group}, ${sql.json({ vi: group, en: group })}, 'nhóm của mẫu Mua hàng (e2e)')
        on conflict (tenant_id, key) do nothing`;
      await sql`insert into admin.group_members (tenant_id, group_id, user_id)
        select ${tenantId}::uuid, g.id, u.id from admin.groups g, admin.users u
        where g.tenant_id = ${tenantId}::uuid and g.key = ${group}
          and u.tenant_id = ${tenantId}::uuid and u.username = ${user}
        on conflict do nothing`;
    }
  });

  // — platform admin gán mẫu cho công ty (UI) —
  const admin = await ctxPage(browser);
  await loginPlatformAdminUi(admin, E.admin, E.adminUser, E.adminPw);
  await openTenantPage(admin, E.tenantName);
  await assignFlowUi(await openCompanyFlows(admin), FLOW);
  await admin.close();

  // — nhân viên tải hợp đồng + «Gửi duyệt» ⇒ lượt chạy mở bước 1 «Đề xuất nhu cầu mua» (form) —
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, Date.now().toString(36), 50_000_000);
  await confirmAndSave(emp);
  // chờ lượt chạy mở xong bước 1 trên chính thẻ này (không đóng trang khi «Gửi duyệt» còn bay)
  await expect(emp.getByTestId(`flow-step-${stageKey(0)}`)).toBeVisible({ timeout: 90_000 });
  await emp.close();

  const shot = (n: string) => testInfo.outputPath(`${n}.png`);
  // 1 Đề xuất (nhân viên) — ô chữ, số, tiền + tệp
  await fillFormAs(
    await ctxPage(browser),
    U.employee,
    id,
    0,
    {
      values: { noi_dung_can_mua: "Máy chủ Dell R760", so_luong: "2", du_toan: "480000000" },
      files: { phieu_de_xuat_mua: "phieu-de-xuat.csv" },
    },
    shot("01-de-xuat-form"),
  );
  // Bước duyệt kế: Trưởng bộ phận thấy giá trị + tên tệp đề xuất chỉ đọc, KHÔNG có ô nhập ở bước đã xong
  const tbp = await ctxPage(browser);
  await approveAs(tbp, E, TRUONG_BP, id, stageName(1));
  await expect(tbp.getByTestId(`flow-step-${stageKey(0)}`)).toContainText("Máy chủ Dell R760");
  // tệp đính kèm hiện ở người sau: từ cr125-run-attachments tệp liên kết với lượt nên người xem lượt thấy TÊN tệp (không còn «Tệp đính kèm»)
  await expect(tbp.getByTestId(`flow-step-${stageKey(0)}`)).toContainText("phieu-de-xuat.csv");
  await expect(tbp.getByTestId(`flow-step-${stageKey(0)}`).locator("form")).toHaveCount(0);
  await tbp.screenshot({ path: shot("02-truong-bo-phan-thay-de-xuat"), fullPage: true });
  await tbp.close();
  // 2 Mua hàng điền báo giá + tệp ⇒ Trưởng mua hàng duyệt
  await fillFormAs(await ctxPage(browser), U.accounting, id, 2, {
    values: { nha_cung_cap: "Công ty An Phát", gia_bao: "470000000" },
    files: { tep_bao_gia: "bao-gia.csv" },
  });
  await approveAs(await ctxPage(browser), E, U.director, id, stageName(3));
  // 3 Mua hàng lập bảng so sánh giá + tệp ⇒ Trưởng bộ phận + Tài chính duyệt
  await fillFormAs(await ctxPage(browser), U.accounting, id, 4, {
    values: { nha_cung_cap_de_xuat: "Công ty An Phát", gia_de_xuat: "470000000" },
    files: { bang_so_sanh_gia: "so-sanh-gia.csv" },
  });
  // dòng 3 «cùng duyệt» (luật tất cả): Trưởng bộ phận duyệt phần mình (bước vẫn mở), rồi Tài chính duyệt ⇒ bước xong
  await approvePart(await ctxPage(browser), TRUONG_BP, id, stageName(5), false);
  await approvePart(await ctxPage(browser), U.director, id, stageName(5), true);
  // 4 Trình ngân sách (Tài chính) + hồ sơ ⇒ Giám đốc duyệt
  await fillFormAs(await ctxPage(browser), U.director, id, 6, {
    values: { ngan_sach_duoc_duyet: "480000000", ghi_chu_trinh_duyet: "Đã đối chiếu 3 báo giá" },
    files: { ho_so_trinh_ngan_sach: "ho-so-ngan-sach.csv" },
  });
  await approveAs(await ctxPage(browser), E, U.director, id, stageName(7));
  // 5 Tạo PO (Mua hàng) + tệp PO ⇒ Trưởng bộ phận duyệt PO ⇒ Kết thúc
  await fillFormAs(
    await ctxPage(browser),
    U.accounting,
    id,
    8,
    { values: { so_po: "PO-2026-001", gia_tri_po: "470000000" }, files: { tep_po: "po.csv" } },
    shot("03-tao-po-form"),
  );
  await approveAs(await ctxPage(browser), E, TRUONG_BP, id, stageName(9));

  const fin = await ctxPage(browser);
  await loginCw(fin, E, U.employee);
  await fin.goto(`${E.cw}/contracts/c/${id}`);
  const tl = fin.locator('[data-approval="timeline"]');
  await expect(tl).toBeVisible({ timeout: 60_000 });
  await expect(tl.getByTestId(`flow-step-${stageKey(8)}`)).toContainText("PO-2026-001", {
    timeout: 60_000,
  });
  await expect(tl.getByTestId(`flow-step-${stageKey(8)}`)).toContainText("po.csv");
  await expect(tl.locator('li[data-status="open"]')).toHaveCount(0, { timeout: 60_000 });
  await tl.screenshot({ path: shot("04-hoan-tat") });
});

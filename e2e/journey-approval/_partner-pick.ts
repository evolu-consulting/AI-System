// CR-126 · «Chọn đối tác & người nhận» · bước người trước khi node «Gửi đối tác xác nhận» gửi đi (dùng chung q6 + s7).
// Người thuộc «Nhóm phụ trách gửi đối tác» mở việc ở «Việc của tôi», thấy đối tác + email điền sẵn từ hợp đồng, đổi email, bấm «Gửi».
// Bộ chọn: `form[data-flow="form"]`, ô `[data-flow-field=<khoá>]` (cùng FormStep với mọi bước điền). Khoá ô theo contract prefill của engine.
import type { Page } from "@playwright/test";
import { withOwner } from "../support/helpers";
import { type Env, loginCw } from "./_journey";
import { expect } from "./_test";

/** Khoá ô «đối tác» (select từ danh sách công ty) và «email người nhận» của việc — khớp prefill của engine (cr126-partner-pick-engine). */
export const PICK = { partner: "partner_tax_code", email: "partner_email" } as const;

/**
 * Đối tác của công ty gửi trong sổ đối tác (nguồn của danh sách chọn `company_partners`). Người dùng thật có được dòng này khi HĐ có bên đối tác
 * hoặc thêm ở «Đối tác»; e2e dựng bằng SQL (đường giống `supplier-quote.repo`: vai `supplier`, nguồn `manual`) vì HĐ mẫu không mang MST của công ty nhận.
 */
export async function seedPartner(tenantKey: string, tax: string, name: string): Promise<void> {
  await withOwner(
    (
      sql,
    ) => sql`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from)
      select t.id, ${`tax:${tax.replace(/\D/g, "")}`}, 'supplier', ${name}, 'manual' from admin.tenants t where t.key = ${tenantKey}
      on conflict (tenant_id, party_key, role) do nothing`,
  );
}

/**
 * Người của nhóm phụ trách: «Việc của tôi» có việc ⇒ mở ⇒ form đã điền sẵn đối tác (MST của công ty nhận) và email ⇒ nhập email SAI
 * thì báo cách sửa ⇒ nhập email CHỌN ⇒ «Gửi». Trả email đã chọn.
 */
export async function pickPartnerAndSend(
  page: Page,
  e: Env,
  user: string,
  o: { partnerTaxCode: string; email: string },
): Promise<string> {
  await loginCw(page, e, user);
  await page.goto(`${e.cw}/contracts/approvals`);
  const row = page.getByTestId(/^(requests-waiting-row|approval-task-row)$/).first();
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.click();
  const form = page.locator('form[data-flow="form"]').first();
  await expect(form).toBeVisible({ timeout: 60_000 });

  // đối tác: gõ MST vào ô tìm ⇒ danh sách còn đúng công ty nhận («tên · MST») ⇒ chọn (HĐ mẫu không có MST đối tác nên chưa điền sẵn)
  const partner = form.locator(`[data-flow-field=${PICK.partner}]`);
  await partner.getByRole("searchbox").fill(o.partnerTaxCode);
  const option = partner.locator("select option", { hasText: o.partnerTaxCode });
  await expect(option).toHaveCount(1, { timeout: 30_000 });
  await partner.locator("select").selectOption((await option.getAttribute("value")) ?? "");

  // email sai dạng ⇒ báo cách sửa, chưa gửi
  const email = form.locator(`[data-flow-field=${PICK.email}] input`);
  await email.fill("khong-phai-email");
  await form.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("ten@congty");
  await expect(form).toBeVisible();

  // email chọn ⇒ gửi (chờ API form OK)
  await email.fill(o.email);
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => /\/review-tasks\/[^/]+\/form/.test(r.url()) && r.request().method() === "POST",
      { timeout: 60_000 },
    ),
    form.getByRole("button", { name: "Gửi", exact: true }).click(),
  ]);
  expect(res.ok()).toBe(true);
  return o.email;
}

/**
 * Thư tới đúng email ĐÃ CHỌN: stack e2e không có SMTP ⇒ kiểm hộp thư đi (`hub.partner_mailbox`, nguồn của bộ gửi thư) của hợp đồng `contractId`
 * có người nhận = email chọn và KHÔNG có dòng nào gửi tới email điền sẵn cũ.
 */
export async function expectMailboxTo(contractId: string, chosen: string): Promise<void> {
  const rows = await withOwner(
    (sql) => sql<{ to_email: string | null }[]>`select to_email from hub.partner_mailbox
      where from_ref = ${contractId} and to_email is not null`,
  );
  expect(rows.map((r) => r.to_email)).toEqual([chosen]);
}

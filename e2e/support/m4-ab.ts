// ADM-FR-40, ADM-FR-42, ADM-FR-51 · helper e2e M4 khối A + B (nhãn nguyên văn plan-frontend §6, ms §7). Không import bun:test.
import { expect, type Page } from "@playwright/test";
import { ID, insertUsage, setQuota, TENANT_ID, withOwner } from "./helpers";

export const ACME = TENANT_ID.acme;
export const GLOBEX = TENANT_ID.globex;
export const KT = ID.feature.keToan;

/** Quota run tháng của acme = `runs`, usage `used` hàng (mỗi hàng 1 run) của acme trong tháng hiện tại. */
export async function seedAcmeRuns(runs: number | null, used: number): Promise<void> {
  await withOwner(async (sql) => {
    if (runs !== null) await setQuota(sql, ACME, null, { runs });
    if (used > 0) await insertUsage(sql, used, { tenant: ACME });
  });
}

/** Ô tìm "Tìm theo tên thực thể…" (role searchbox hoặc textbox tuỳ cài đặt). */
export const auditSearch = (page: Page) =>
  page
    .getByRole("searchbox", { name: "Tìm theo tên thực thể…" })
    .or(page.getByRole("textbox", { name: "Tìm theo tên thực thể…" }));

export const auditItems = (page: Page) =>
  page.getByRole("list", { name: "Nhật ký thay đổi" }).getByRole("listitem");

/** Dòng audit mới nhất (danh sách giảm dần theo seq) có chứa `text`. */
export const auditRow = (page: Page, text: string | RegExp) =>
  auditItems(page).filter({ hasText: text }).first();

export async function openAudit(page: Page): Promise<void> {
  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Nhật ký thay đổi" })).toBeVisible();
}

/** Mở Sheet chi tiết từ dòng audit mới nhất khớp `text`. */
export async function openDetail(page: Page, text: string | RegExp) {
  await auditRow(page, text).getByRole("button", { name: "Xem thay đổi" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

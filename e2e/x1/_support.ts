// X1 e2e admin · helper dùng chung (stub Hub điều khiển qua `/__stub/*`, đăng nhập, dựng lệnh nháp).
import { expect, type Page } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture, withOwner } from "../support/helpers";

export { ID, ID3, TENANT_ID, toast, USER_ID } from "../support/helpers";
export { loginAdmin, loginAs, resetFixture, withOwner };

export const HUB = process.env.X1_HUB_URL ?? "http://localhost:4030";
/** Token Hub của admin-api (sinh trong config, `process.env` kế thừa); KHÔNG bao giờ được xuất hiện ở trình duyệt. */
export const hubToken = (): string => process.env.HUB_INTERNAL_TOKEN ?? "";

export type StubRec = {
  method: string;
  path: string;
  search: string;
  auth: boolean;
  authOk: boolean;
  body: unknown;
  aborted?: boolean;
};

export async function stubReset(): Promise<void> {
  const r = await fetch(`${HUB}/__stub/reset`, { method: "POST" });
  if (!r.ok) throw new Error(`/__stub/reset → ${r.status}`);
}
export async function stubMode(m: { testRun?: string; grantWrite?: string }): Promise<void> {
  const r = await fetch(`${HUB}/__stub/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(m),
  });
  if (!r.ok) throw new Error(`/__stub/mode → ${r.status}`);
}
export async function stubRequests(path?: string): Promise<StubRec[]> {
  const all = (await (await fetch(`${HUB}/__stub/requests`)).json()) as StubRec[];
  return path ? all.filter((r) => r.path === path || r.path.startsWith(path)) : all;
}

export const SETUP = async (): Promise<void> => {
  resetFixture();
  await stubReset();
};

/** `side_effect` của workflow (cột đã có sau B1; thiếu cột ⇒ lỗi SQL ở dựng dữ liệu = báo B1 chưa xong). */
export async function setSideEffect(workflowId: string, on: boolean): Promise<void> {
  await withOwner(async (sql) => {
    await sql`update admin.workflows set side_effect = ${on} where id = ${workflowId}`;
  });
}

const source = (page: Page, input: string) =>
  page.getByRole("combobox", { name: `Nguồn của ${input}` });
export async function pickSource(page: Page, input: string, label: string): Promise<void> {
  await source(page, input).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** Lệnh MỚI (chưa lưu) trên workflow `translate`: tên, mô tả, source_text ← đoạn bôi đen, target_lang ← 'vi'. */
export async function fillDraftCommand(page: Page): Promise<void> {
  await page.goto("/commands/new");
  await expect(page.getByRole("textbox", { name: "Tên command" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tên command" }).fill("dich-nhap");
  await page.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Lệnh nháp để chạy thử");
  await page.getByRole("combobox", { name: "Workflow", exact: true }).click();
  await page
    .getByRole("option", { name: /(?<![\w-])translate(?![\w-])/ })
    .first()
    .click();
  await pickSource(page, "source_text", "Đoạn bôi đen");
  await pickSource(page, "target_lang", "Giá trị cố định");
  await page.getByRole("textbox", { name: "Giá trị của target_lang" }).fill("vi");
}

export const testButton = (page: Page) =>
  page.getByRole("button", { name: "Chạy thử", exact: true }).first();

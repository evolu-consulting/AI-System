// ADM-FR-55 · AC-A07 · helper cho e2e `ConflictDialog` (nhãn nguyên văn plan-frontend §5, câu R21/R22 theo A4).
// `{time}` do formatClock nên khớp bằng regex `lúc [^()]+ \(v…\)` (không giả định định dạng giờ).
import { expect, type Page } from "@playwright/test";
import { toast, withOwner } from "./helpers";

export const CONFLICT_TITLE = "Có người vừa lưu bản mới hơn";
export const conflictDialog = (page: Page) =>
  page.getByRole("alertdialog", { name: CONFLICT_TITLE });

/** `version` hiện tại của một hàng (owner). */
export async function versionOf(table: string, id: string): Promise<number> {
  return withOwner(async (sql) => {
    const [r] = await sql.unsafe(`select version::int as n from admin.${table} where id = '${id}'`);
    return (r as unknown as { n: number }).n;
  });
}

export type BodyOpts = { entity: string; latest: number; mine: number; user?: string };

/** Hộp thoại hiện đúng câu: có `{user}` (workflow/command/feature/group) hoặc không (user/tenant). */
export async function expectConflictBody(page: Page, o: BodyOpts) {
  const dlg = conflictDialog(page);
  await expect(dlg).toBeVisible();
  const tail = `\\(v${o.latest}\\)\\. Bản của bạn dựa trên v${o.mine}\\.`;
  const re = o.user
    ? new RegExp(`${o.user} vừa sửa ${o.entity} này lúc [^()]+ ${tail}`)
    : new RegExp(`Bản này vừa được sửa lúc [^()]+ ${tail}`);
  await expect(dlg).toContainText(re);
  await expect(dlg.getByRole("button", { name: "Xem khác biệt" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Ghi đè", exact: true })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Tải bản mới" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tải lại", exact: true })).toHaveCount(0);
}

/** Mở "Xem khác biệt": chỉ hiện trường khác (`fields`), không hiện `absent`. */
export async function expectDiff(
  page: Page,
  o: { latest: number; fields: string[]; absent: string[] },
) {
  const dlg = conflictDialog(page);
  const diff = dlg.getByRole("button", { name: "Xem khác biệt" });
  await diff.click();
  await expect(diff).toHaveAttribute("aria-expanded", "true");
  const table = dlg.getByRole("table", { name: "Khác biệt giữa bản của bạn và bản mới nhất" });
  await expect(table).toBeVisible();
  for (const h of ["Trường", "Bản của bạn", `Bản mới nhất (v${o.latest})`]) {
    await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
  }
  for (const f of o.fields)
    await expect(table.getByRole("row").filter({ hasText: f }).first()).toBeVisible();
  for (const f of o.absent)
    await expect(table.getByRole("row").filter({ hasText: f })).toHaveCount(0);
}

/** `Ghi đè` → ConfirmDialog con (câu R22) → xác nhận → hộp thoại đóng. */
export async function overwrite(page: Page, o: { latest: number; user?: string }) {
  await conflictDialog(page).getByRole("button", { name: "Ghi đè", exact: true }).click();
  const title = o.user ? `Ghi đè thay đổi của ${o.user}?` : "Ghi đè thay đổi mới nhất?";
  const confirm = page.getByRole("alertdialog", { name: title });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    `Bản v${o.latest} sẽ bị thay bằng bản của bạn (thành v${o.latest + 1}).`,
  );
  await confirm.getByRole("button", { name: "Ghi đè", exact: true }).click();
  await expect(conflictDialog(page)).toHaveCount(0);
}

/** `Tải bản mới` → toast "Đã tải bản mới nhất · v{n}"; bỏ thay đổi của mình. */
export async function reloadLatest(page: Page, latest: number) {
  await conflictDialog(page).getByRole("button", { name: "Tải bản mới" }).click();
  await expect(toast(page, `Đã tải bản mới nhất · v${latest}`)).toBeVisible();
  await expect(conflictDialog(page)).toHaveCount(0);
}

/** Giá trị một cột của một hàng (owner), để so với bản của mình/của người kia. */
export async function dbValue(table: string, id: string, column: string): Promise<unknown> {
  return withOwner(async (sql) => {
    const [r] = await sql.unsafe(`select ${column} as v from admin.${table} where id = '${id}'`);
    return (r as unknown as { v: unknown }).v;
  });
}

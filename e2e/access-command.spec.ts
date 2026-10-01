// ADM-FR-24 · M3-AC10 · M3-R14 · e2e tab "Ai dùng được" của command: cột Group được cấp, Số user thấy (test-plan E-ACM; tên file đổi
// từ commands-access để mẫu `commands` của FE1c không khớp nhầm). Chỉ platform_admin. Nhãn nguyên văn plan-frontend §5.
// Số liệu: /kiemtra-hoadon acme có nhóm ke-toan·ke-toan, 2 user thấy; /dich tổng 5 tenant · 66 user (bulk 55).
import { expect, type Page, test } from "@playwright/test";
import { ID, loginAdmin, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const openAccess = async (page: Page, commandId: string) => {
  await loginAdmin(page);
  await page.goto(`/commands/${commandId}?tab=access`);
  const table = page.getByRole("tabpanel").getByRole("table");
  await expect(table).toBeVisible();
  return table;
};
const tenantRow = (table: ReturnType<Page["getByRole"]>, key: string) =>
  table.getByRole("row").filter({ hasText: key });

test("ADM-FR-24 · M3-R14 · /kiemtra-hoadon: columnheader 'Group được cấp' và 'Số user thấy'; hàng acme có chip 'Kế toán · Kế toán' và số user thấy 2", async ({
  page,
}) => {
  const table = await openAccess(page, ID.command.kiemtraHoadon);
  await expect(table.getByRole("columnheader", { name: "Group được cấp" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Số user thấy" })).toBeVisible();
  const acme = tenantRow(table, "acme");
  await expect(acme).toContainText("Kế toán · Kế toán");
  await expect(acme).toContainText("2");
});

test("M3-AC10 · ADM-FR-24 · /dich: acme 6 user thấy, trigger tab tổng '5 tenant · 66 user'; card 'Quyền theo nhóm và người dùng chưa khả dụng.' KHÔNG còn; nhóm trống → 'Chưa group nào được cấp'", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  await expect(page.getByRole("tab", { name: /Ai dùng được/ })).toContainText("5 tenant · 66 user");
  await page.getByRole("tab", { name: /Ai dùng được/ }).click();
  const table = page.getByRole("tabpanel").getByRole("table");
  await expect(tenantRow(table, "acme")).toContainText("6");
  await expect(tenantRow(table, "bulk")).toContainText("55");
  await expect(page.getByText("Quyền theo nhóm và người dùng chưa khả dụng.")).toHaveCount(0);
  await expect(tenantRow(table, "acme")).toContainText("Chưa group nào được cấp");
});

test("ADM-FR-24 · M3-R14 · /xuat-bao-cao: chip 'beta-testers' (group Beta) và số user thấy 0 (command tắt); tab khoá khi tạo command mới (giữ M2)", async ({
  page,
}) => {
  const table = await openAccess(page, ID.command.xuatBaoCao);
  const acme = tenantRow(table, "acme");
  await expect(acme).toContainText("Beta testers");
  await expect(acme).toContainText("0");
  await page.goto("/commands/new");
  await expect(page.getByRole("tab", { name: /Ai dùng được/ })).toBeDisabled();
});

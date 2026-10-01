// ADM-FR-36 · M3-R11, R12, R13 · e2e Phân quyền › Kiểm tra quyền (F4; test-plan E-AC). Nhãn nguyên văn plan-frontend §5, §7.
// Số liệu: lan thấy 3/5 command; an thiếu grant kiemtra-hoadon; thu thuộc beta-testers; em inactive; khang globex (thu hồi).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture, toast, USER_ID, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const openCheck = async (
  page: Page,
  user: string,
  tenant = "acme",
  as: "binh" | "admin" = "binh",
) => {
  if (as === "admin") await loginAdmin(page);
  else await loginAs(page, "acme", "binh");
  await page.goto(`/access?tab=check&user=${user}&tenant=${tenant}`);
  await expect(page.getByRole("heading", { level: 3, name: "Command" })).toBeVisible();
};
const showHidden = async (page: Page, n: number) =>
  page.getByRole("button", { name: `Hiện command không thấy (${n})` }).click();

test("ADM-FR-36 · M3-R12 · lan: 3 nhóm Feature/Command/Agent; 'Thấy /kiemtra-hoadon' kèm 'qua feature Kế toán · group Kế toán'; tóm tắt 'Thấy 3/5 command'; Agent 'Chưa khả dụng' và KHÔNG gọi API agent", async ({
  page,
}) => {
  const agentCalls: string[] = [];
  page.on("request", (r) => {
    if (/agent/i.test(new URL(r.url()).pathname)) agentCalls.push(r.url());
  });
  await openCheck(page, "lan");
  for (const h of ["Feature", "Command", "Agent"]) {
    await expect(page.getByRole("heading", { level: 3, name: h })).toBeVisible();
  }
  await expect(page.getByText("Thấy /kiemtra-hoadon")).toBeVisible();
  await expect(page.getByText("qua feature Kế toán · group Kế toán")).toBeVisible();
  await expect(page.getByText("Thấy 3/5 command")).toBeVisible();
  await expect(page.getByText("Chưa khả dụng")).toBeVisible();
  expect(agentCalls).toEqual([]);
});

test("ADM-FR-36 · F4 · an: 'Hiện command không thấy (3)' → /kiemtra-hoadon 'Vì sao không?' → 'Feature Kế toán chưa cấp cho an hay group nào của an.' + nút 'Cấp Kế toán cho group…' → dialog 'Cấp Kế toán cho group' → chọn Kế toán → Cấp → toast 'Đã cấp Kế toán cho group Kế toán'", async ({
  page,
}) => {
  await openCheck(page, "an");
  await showHidden(page, 3);
  await page.getByRole("button", { name: "Vì sao không?" }).first().click();
  await expect(
    page.getByText("Feature Kế toán chưa cấp cho an hay group nào của an."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cấp Kế toán cho group…" }).click();
  const dialog = page.getByRole("dialog", { name: "Cấp Kế toán cho group" });
  await dialog.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "Kế toán", exact: true }).click();
  await dialog.getByRole("button", { name: "Cấp", exact: true }).click();
  await expect(toast(page, "Đã cấp Kế toán cho group Kế toán")).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("ADM-FR-36 · M3-R13 · ô 'Tìm command' gõ 'kiemtra' lọc danh sách (không dấu '/')", async ({
  page,
}) => {
  await openCheck(page, "lan");
  await page.getByRole("searchbox", { name: "Tìm command" }).fill("kiemtra");
  await expect(page.getByText("Thấy /kiemtra-hoadon")).toBeVisible();
  await expect(page.getByText("Thấy /dich")).toHaveCount(0);
});

test("ADM-FR-36 · M3-R12 · thu: command tắt 'Command đang tắt.' và workflow tắt 'Workflow của command đang tắt.' (xuat-bao-cao); bao-cao hiệu lực 'qua group beta-testers'", async ({
  page,
}) => {
  await openCheck(page, "thu");
  await expect(page.getByText("qua group beta-testers").first()).toBeVisible();
  await showHidden(page, 2);
  await page.getByRole("button", { name: "Vì sao không?" }).first().click();
  await page.getByRole("button", { name: "Vì sao không?" }).last().click();
  await expect(page.getByText("Command đang tắt.").first()).toBeVisible();
  await expect(page.getByText("Workflow của command đang tắt.")).toBeVisible();
});

test("ADM-FR-36 · M3-R11 · em (inactive): lý do 'Tài khoản này đang bị khoá.'; không thấy command nào ('Thấy 0/5 command')", async ({
  page,
}) => {
  await openCheck(page, "em");
  await expect(page.getByText("Thấy 0/5 command")).toBeVisible();
  await showHidden(page, 5);
  await page.getByRole("button", { name: "Vì sao không?" }).first().click();
  await expect(page.getByText("Tài khoản này đang bị khoá.").first()).toBeVisible();
});

test("ADM-BR-12 · M3-R12 · platform xem khang (globex): 'Hiện feature không dùng được (5)' → 'Feature Kế toán chưa được mở cho công ty. Liên hệ nền tảng để mở.' + link 'Mở feature Kế toán'", async ({
  page,
}) => {
  await openCheck(page, "khang", "globex", "admin");
  await page.getByRole("button", { name: "Hiện feature không dùng được (5)" }).click();
  await expect(
    page.getByText("Feature Kế toán chưa được mở cho công ty. Liên hệ nền tảng để mở."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở feature Kế toán" })).toBeVisible();
});

test("ADM-BR-12 · M3-R12 · tenant_admin xem lan: lý do no_entitlement (Pháp chế) KHÔNG có link 'Mở feature…' (chỉ platform có)", async ({
  page,
}) => {
  await openCheck(page, "lan");
  await page.getByRole("button", { name: /Hiện feature không dùng được/ }).click();
  await expect(
    page.getByText("Feature Pháp chế chưa được mở cho công ty. Liên hệ nền tảng để mở."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Mở feature/ })).toHaveCount(0);
});

test("ADM-FR-34 · M3-R12 · lan: bao-cao thiếu thành viên beta → nút 'Thêm lan vào beta-testers' → lan vào beta-testers (DB) → bao-cao hiệu lực 'qua group beta-testers'", async ({
  page,
}) => {
  await openCheck(page, "lan");
  await page.getByRole("button", { name: /Hiện feature không dùng được/ }).click();
  await page.getByRole("button", { name: "Thêm lan vào beta-testers" }).click();
  await expect(page.getByText("qua group beta-testers").first()).toBeVisible();
  const n = await withOwner(async (sql) => {
    const [r] = await sql`select count(*)::int as n from admin.group_members m
      join admin.groups g on g.id = m.group_id
      where g.key = 'beta-testers' and m.user_id = ${USER_ID.lan}`;
    return r?.n;
  });
  expect(n).toBe(1);
});

test("ADM-FR-36 · M3-R13 · username không có trong tenant → 'Không tìm thấy người dùng này trong tenant.'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/access?tab=check&user=khong-co&tenant=acme");
  await expect(page.getByText("Không tìm thấy người dùng này trong tenant.")).toBeVisible();
});

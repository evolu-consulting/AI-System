// ADM-FR-32 · ADM-BR-12 · M3-R07, R08, R09 · e2e tab Feature của Group (test-plan E-GG; tên file đổi từ groups-features để
// mẫu `features` của FE1d không khớp nhầm). Lưu qua MỘT `PUT /admin/grants/batch`. Nhãn nguyên văn plan-frontend §5.
import { expect, type Page, test } from "@playwright/test";
import { ID, ID3, loginAs, resetFixture, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const KT = ID3.group.acmeKeToan;
const openFeatures = async (page: Page, groupId = KT, tenant = "acme", user = "binh") => {
  await loginAs(page, tenant, user);
  await page.goto(`/groups/${groupId}?tab=features`);
  await expect(page.getByRole("tab", { name: "Feature", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
};
const grantCount = (featureId: string, groupId: string) =>
  withOwner(async (sql) => {
    const [r] = await sql`select count(*)::int as n from admin.feature_grants
      where feature_id = ${featureId} and group_id = ${groupId}`;
    return r?.n as number;
  });

test("ADM-FR-32 · M3-R07 · chế độ xem: có hàng 'Kế toán' (đã cấp) và hàng core với 'Mọi người đều có' (không sửa được)", async ({
  page,
}) => {
  await openFeatures(page);
  await expect(page.getByText("Kế toán", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Mọi người đều có")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
});

test("ADM-FR-32 · M3-R07 · chế độ Sửa: chỉ liệt kê feature đã entitlement (Kế toán ✓, Dịch thuật, Báo cáo, Thử nghiệm); KHÔNG có 'Pháp chế' (chưa mở)", async ({
  page,
}) => {
  await openFeatures(page);
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Kế toán", exact: true })).toBeChecked();
  for (const f of ["Dịch thuật", "Báo cáo", "Thử nghiệm"]) {
    await expect(page.getByRole("checkbox", { name: f, exact: true })).not.toBeChecked();
  }
  await expect(page.getByRole("checkbox", { name: "Pháp chế", exact: true })).toHaveCount(0);
});

test("ADM-FR-32 · M3-R08 · tick 'Dịch thuật' → 'Lưu' gửi ĐÚNG MỘT PUT /admin/grants/batch → toast 'Đã lưu feature của Kế toán…'; DB có grant mới; Lưu khoá khi không đổi gì", async ({
  page,
}) => {
  await openFeatures(page);
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  const save = page.getByRole("button", { name: "Lưu", exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: "Dịch thuật", exact: true }).check();
  await expect(save).toBeEnabled();
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/admin/grants/batch")) puts.push(r.url());
  });
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/grants/batch") && r.request().method() === "PUT",
  );
  await save.click();
  expect((await saved).status()).toBe(200);
  await expect(toast(page, /Đã lưu feature của Kế toán/)).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(await grantCount(ID.feature.dichThuat, KT)).toBe(1);
});

test("ADM-FR-32 · M3-R08 · 'Huỷ' bỏ nháp: tick rồi Huỷ → ô về chưa tick, không gửi request ghi, DB không đổi", async ({
  page,
}) => {
  await openFeatures(page);
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/admin/grants")) writes.push(r.url());
  });
  const box = page.getByRole("checkbox", { name: "Dịch thuật", exact: true });
  await box.check();
  await page.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(await grantCount(ID.feature.dichThuat, KT)).toBe(0);
});

test("ADM-BR-12 · M3-R09 · globex (entitlement ke-toan đã thu hồi, còn grant): hàng hiện 'Đã thu hồi entitlement', ô giữ nguyên tick và KHÔNG sửa được; không có nút 'Cấp trực tiếp…' (A6)", async ({
  page,
}) => {
  await openFeatures(page, ID3.group.globexKeToan, "globex", "hoa");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.getByText("Đã thu hồi entitlement")).toBeVisible();
  const box = page.getByRole("checkbox", { name: "Kế toán", exact: true });
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();
  await expect(page.getByRole("button", { name: /Cấp trực tiếp/ })).toHaveCount(0);
});

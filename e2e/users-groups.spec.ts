// ADM-FR-62 · M3-R13 · A11 · e2e Users: cột Groups, lọc Group, ô Groups CHỈ ĐỌC trong drawer (test-plan E-UG).
// Nhãn nguyên văn plan-frontend §5. Dữ liệu: lan/thu/em ở nhóm ke-toan; thu cũng ở beta-testers; an chưa ở nhóm nào.
import { expect, type Page, test } from "@playwright/test";
import {
  ID3,
  loginAdmin,
  loginAs,
  resetFixture,
  rowOf,
  TENANT_ID,
  USER_ID,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const openUsers = async (page: Page, qs = "") => {
  await loginAs(page, "acme", "binh");
  await page.goto(`/users${qs}`);
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
};

test("ADM-FR-62 · M3-R13 · cột 'Groups' (columnheader); hàng thu có chip 'Beta testers' và 'Kế toán'; hàng an trống ('—')", async ({
  page,
}) => {
  await openUsers(page);
  await expect(page.getByRole("columnheader", { name: "Groups" })).toBeVisible();
  await expect(rowOf(page, "Users", "thu")).toContainText("Beta testers");
  await expect(rowOf(page, "Users", "thu")).toContainText("Kế toán");
  await expect(rowOf(page, "Users", "an")).toContainText("—");
});

test("ADM-FR-62 · M3-R13 · user ở 4 group (beta-testers, ke-toan + 2 thêm) → tối đa 2 chip + chip '+2'", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    for (const k of ["nhom-1", "nhom-2"]) {
      const [g] = await sql<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
        values (${TENANT_ID.acme}, ${k}, jsonb_build_object('vi', ${`Nhóm ${k}`})) returning id`;
      await sql`insert into admin.group_members (tenant_id, group_id, user_id)
        values (${TENANT_ID.acme}, ${g?.id as string}, ${USER_ID.thu})`;
    }
  });
  await openUsers(page);
  await expect(rowOf(page, "Users", "thu")).toContainText("+2");
});

test("ADM-FR-62 · M3-R13 · combobox 'Group' (có mục 'Tất cả group'): chọn 'Kế toán' → URL ?group=ke-toan và bảng chỉ còn lan, thu, em", async ({
  page,
}) => {
  await openUsers(page);
  const picker = page.getByRole("combobox", { name: "Group" });
  await expect(picker).toContainText("Tất cả group");
  await picker.click();
  await page.getByRole("option", { name: "Kế toán", exact: true }).click();
  await expect(page).toHaveURL(/group=ke-toan/);
  for (const u of ["lan", "thu", "em"]) await expect(rowOf(page, "Users", u)).toBeVisible();
  await expect(rowOf(page, "Users", "an")).toHaveCount(0);
});

test("ADM-FR-62 · M3-R13 · ?group=khong-co (key lạ) → bỏ lọc, hiện chip lọc 'Group: khong-co' (không 404); bảng vẫn có an", async ({
  page,
}) => {
  await openUsers(page, "?group=khong-co");
  await expect(page.getByText("Group: khong-co")).toBeVisible();
  await expect(rowOf(page, "Users", "an")).toBeVisible();
});

test("ADM-FR-62 · M3-R13 · platform chưa chọn tenant → combobox 'Group' bị khoá ('Chọn tenant trước')", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Group" });
  await expect(picker).toBeDisabled();
  await expect(picker).toHaveAttribute("title", "Chọn tenant trước");
});

test("ADM-FR-62 · M3-R13 · A11 · drawer sửa lan: tab 'Thông tin' có list 'Groups' CHỈ ĐỌC (chip link tới /groups/<id>), gợi ý 'Sửa thành viên ở trang Group.', không có combobox sửa Groups; an → 'Chưa thuộc group nào'", async ({
  page,
}) => {
  await openUsers(page);
  const open = async (u: string) => {
    await rowOf(page, "Users", u).getByRole("button", { name: "Thao tác khác" }).click();
    await page.getByRole("menuitem", { name: "Sửa", exact: true }).click();
  };
  await open("lan");
  const drawer = page.getByRole("dialog", { name: /lan · / });
  await expect(drawer.getByRole("tab", { name: "Thông tin" })).toBeVisible();
  const list = drawer.getByRole("list", { name: "Groups" });
  await expect(list.getByRole("link", { name: "Kế toán" })).toHaveAttribute(
    "href",
    new RegExp(`/groups/${ID3.group.acmeKeToan}`),
  );
  await expect(drawer.getByText("Sửa thành viên ở trang Group.")).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Groups" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await open("an");
  await expect(
    page.getByRole("dialog", { name: /an · / }).getByText("Chưa thuộc group nào"),
  ).toBeVisible();
});

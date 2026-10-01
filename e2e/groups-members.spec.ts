// ADM-FR-62 · M3-AC02 · M3-R03, R05 · e2e tab Thành viên của Group (test-plan E-GM): thêm từng người, bỏ + Hoàn tác, dán danh sách
// (tách, partial add, not_found, tối đa 500). Nhãn nguyên văn plan-frontend §5. Dữ liệu: ke-toan = lan, thu, em.
import { expect, type Page, test } from "@playwright/test";
import { ID3, loginAs, resetFixture, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const KT = ID3.group.acmeKeToan;
const memberRow = (page: Page, username: string) =>
  page
    .getByRole("table", { name: "Thành viên" })
    .getByRole("row")
    .filter({ hasText: new RegExp(`(?<![\\w.-])${username.replace(".", "\\.")}(?![\\w.-])`) });
const openMembers = async (page: Page) => {
  await loginAs(page, "acme", "binh");
  await page.goto(`/groups/${KT}?tab=members`);
  await expect(page.getByRole("table", { name: "Thành viên" })).toBeVisible();
};
const memberCount = () =>
  withOwner(async (sql) => {
    const [r] =
      await sql`select count(*)::int as n from admin.group_members where group_id = ${KT}`;
    return r?.n as number;
  });
const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `u${String(i).padStart(3, "0")}`).join("\n");

test("ADM-FR-62 · M3-R03 · bảng Thành viên: lan, thu, em (em inactive vẫn là thành viên); thu có chip beta-testers ở cột Group khác", async ({
  page,
}) => {
  await openMembers(page);
  for (const u of ["lan", "thu", "em"]) await expect(memberRow(page, u)).toBeVisible();
  await expect(memberRow(page, "thu")).toContainText("beta-testers");
  await expect(memberRow(page, "an")).toHaveCount(0);
});

test("ADM-FR-62 · M3-R03 · combobox 'Thêm người': chọn an → toast 'Đã thêm an vào Kế toán', hàng an xuất hiện, DB +1", async ({
  page,
}) => {
  await openMembers(page);
  const before = await memberCount();
  await page.getByRole("combobox", { name: "Thêm người" }).click();
  await page.getByRole("combobox", { name: "Thêm người" }).fill("an");
  await page
    .getByRole("option", { name: /\ban\b/ })
    .first()
    .click();
  await expect(toast(page, "Đã thêm an vào Kế toán")).toBeVisible();
  await expect(memberRow(page, "an")).toBeVisible();
  expect(await memberCount()).toBe(before + 1);
});

test("ADM-FR-62 · M3-R03 · 'Bỏ lan khỏi group' → toast 'Đã bỏ lan khỏi Kế toán' + 'Hoàn tác' (bấm trong 5 s → lan trở lại, DB đúng 1 hàng)", async ({
  page,
}) => {
  await openMembers(page);
  await page.getByRole("button", { name: "Bỏ lan khỏi group" }).click();
  const t = toast(page, "Đã bỏ lan khỏi Kế toán");
  await expect(t).toBeVisible();
  await expect(memberRow(page, "lan")).toHaveCount(0);
  await t.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(memberRow(page, "lan")).toBeVisible();
  const n = await withOwner(async (sql) => {
    const [r] = await sql`select count(*)::int as n from admin.group_members
      where group_id = ${KT} and user_id = '01900000-0000-7000-8000-000000000014'`;
    return r?.n;
  });
  expect(n).toBe(1);
});

test("M3-AC02 · ADM-FR-62 · dán 'dung, an.vu⏎binh  khang' → đếm '4 username'; 'Thêm 4 người' → toast 'Đã thêm 2 người, 2 username không tìm thấy'; status 'Không tìm thấy: an.vu, khang'; ô dán chỉ còn not_found; DB +2 (dung, binh)", async ({
  page,
}) => {
  await openMembers(page);
  const before = await memberCount();
  const box = page.getByRole("textbox", { name: "Dán danh sách username" });
  await box.fill("dung, an.vu\nbinh  khang");
  await expect(page.getByText("4 username")).toBeVisible();
  await page.getByRole("button", { name: "Thêm 4 người" }).click();
  await expect(toast(page, "Đã thêm 2 người, 2 username không tìm thấy")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Không tìm thấy: an.vu, khang" }),
  ).toBeVisible();
  await expect(box).toHaveValue(/an\.vu/);
  await expect(box).not.toHaveValue(/dung/);
  expect(await memberCount()).toBe(before + 2);
  await expect(memberRow(page, "dung")).toBeVisible();
  await expect(memberRow(page, "binh")).toBeVisible();
});

test("ADM-FR-62 · M3-R03 · dán 501 username → 'Tối đa 500 username mỗi lần. Bạn đã dán 501.' và nút Thêm bị khoá, không gọi API thêm", async ({
  page,
}) => {
  await openMembers(page);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/members")) posts.push(r.url());
  });
  await page.getByRole("textbox", { name: "Dán danh sách username" }).fill(names(501));
  await expect(page.getByText("Tối đa 500 username mỗi lần. Bạn đã dán 501.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Thêm \d+ người$/ })).toBeDisabled();
  expect(posts).toEqual([]);
});

test("ADM-FR-62 · M3-R03 · dán đúng 500 username → nút 'Thêm 500 người' bật (không bấm)", async ({
  page,
}) => {
  await openMembers(page);
  await page.getByRole("textbox", { name: "Dán danh sách username" }).fill(names(500));
  await expect(page.getByRole("button", { name: "Thêm 500 người" })).toBeEnabled();
});

test("ADM-FR-62 · M3-R03 · dán người đã có (lan) → xem trước chỉ hiện '1 người đã ở trong group' (dry_run, không ghi); số trên nút = số username đã tách", async ({
  page,
}) => {
  await openMembers(page);
  const before = await memberCount();
  await page.getByRole("textbox", { name: "Dán danh sách username" }).fill("lan");
  await expect(page.getByText("1 người đã ở trong group")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm 1 người" })).toBeVisible();
  expect(await memberCount()).toBe(before);
});

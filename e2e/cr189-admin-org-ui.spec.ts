// CR-189 · BR-189-6 · HÀNH TRÌNH «Cơ cấu sửa trực tiếp trên sơ đồ» (Admin › Công ty › Thành viên › Cơ cấu): «+» thêm phòng con gõ tên tại chỗ,
// bấm tên đổi tên, «⋯» (trưởng phòng · thành viên · chuyển · xoá), kéo thả (máy tính), Hoàn tác 6 giây, điện thoại chỉ «⋯».
// Do quản trị công ty (tenant_admin `binh`) làm; dữ liệu dựng bằng API do quản trị nền tảng (khác người làm — N2). admin-api + DB e2e THẬT.
// VIẾT, CHƯA CHẠY (điều phối chạy một lần cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import {
  apiAsAdmin,
  loginAs,
  resetFixture,
  TENANT_ID,
  USER_ID,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const T = `tenant_id=${TENANT_ID.acme}`;
const node = (page: Page, id: string) => page.getByTestId(`org-node-${id}`);
const undo = (page: Page, msg: string | RegExp) =>
  page.getByRole("status").filter({ hasText: msg }).getByRole("button", { name: "Hoàn tác" });
const parentOf = (id: string) =>
  withOwner(
    async (s) =>
      (
        await s<
          { p: string | null }[]
        >`select parent_group_id as p from admin.departments where group_id = ${id}`
      )[0]?.p,
  );
const nameOf = (id: string) =>
  withOwner(
    async (s) =>
      (await s<{ n: string }[]>`select name ->> 'vi' as n from admin.groups where id = ${id}`)[0]
        ?.n,
  );

type Ids = { kd: string; kt: string; hn: string; trong: string };
let ids: Ids;

async function open(page: Page) {
  await loginAs(page, "acme", "binh");
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=members&view=org`);
  await expect(page.getByTestId("org-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("org-tree")).toBeVisible({ timeout: 30_000 });
}

test("dựng dữ liệu bằng API (quản trị nền tảng): 4 phòng, 2 người ở Kinh doanh", async ({
  request,
}) => {
  const api = await apiAsAdmin(request);
  const mk = async (name: string, parent?: string) => {
    const r = await api.post(`/admin/org/departments?${T}`, {
      name,
      parent_group_id: parent ?? null,
    });
    expect(r.status()).toBe(201);
    return ((await r.json()) as { group_id: string }).group_id;
  };
  const kd = await mk("Kinh doanh");
  const kt = await mk("Kế toán");
  const hn = await mk("Hà Nội", kd);
  const trong = await mk("Dự án trống");
  ids = { kd, kt, hn, trong };
  const m = await api.post(`/admin/org/departments/${kd}/members?${T}`, {
    user_ids: [USER_ID.lan, USER_ID.an],
  });
  expect(m.status()).toBe(200);
});

test("«+» dưới thẻ ⇒ gõ tên phòng con tại chỗ ⇒ thẻ mới hiện, tên trùng cùng cấp báo lỗi ngay ô, Hoàn tác xoá phòng vừa thêm", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId(`org-add-${ids.kt}`).click();
  await page.getByTestId(`org-add-input-${ids.kt}`).fill("Thuế");
  await page.getByTestId(`org-add-input-${ids.kt}`).press("Enter");
  await expect(page.getByTestId("org-tree")).toContainText("Thuế");
  await expect(page.getByRole("status").filter({ hasText: "Đã thêm phòng" })).toBeVisible();
  await undo(page, "Đã thêm phòng").click();
  await expect(page.getByTestId("org-tree")).not.toContainText("Thuế");
  // trùng tên cùng cấp (không phân hoa/thường) ⇒ lỗi tại ô, không thêm
  await page.getByTestId(`org-add-${ids.kd}`).click();
  await page.getByTestId(`org-add-input-${ids.kd}`).fill("hà nội");
  await page.getByTestId(`org-add-ok-${ids.kd}`).click();
  await expect(page.getByTestId(`org-add-form-${ids.kd}`).getByRole("alert")).toContainText(
    "Đã có phòng cùng tên",
  );
  // thêm phòng cấp cao nhất từ thẻ Công ty
  await page.getByTestId("org-add-__company__").click();
  await page.getByTestId("org-add-input-__company__").fill("Marketing");
  await page.getByTestId("org-add-ok-__company__").click();
  await expect(page.getByTestId("org-tree")).toContainText("Marketing");
});

test("bấm tên ⇒ đổi tên tại chỗ (Enter lưu, Esc bỏ), Hoàn tác trả tên cũ", async ({ page }) => {
  await open(page);
  await page.getByTestId(`org-rename-${ids.kt}`).click();
  await page.getByTestId(`org-rename-input-${ids.kt}`).fill("Tài chính kế toán");
  await page.getByTestId(`org-rename-input-${ids.kt}`).press("Enter");
  await expect(node(page, ids.kt)).toContainText("Tài chính kế toán");
  expect(await nameOf(ids.kt)).toBe("Tài chính kế toán");
  await undo(page, "Đã đổi tên").click();
  await expect(node(page, ids.kt)).toContainText("Kế toán");
  expect(await nameOf(ids.kt)).toBe("Kế toán");
  await page.getByTestId(`org-rename-${ids.kt}`).click();
  await page.getByTestId(`org-rename-input-${ids.kt}`).fill("Bỏ qua");
  await page.getByTestId(`org-rename-input-${ids.kt}`).press("Escape");
  await expect(node(page, ids.kt)).toContainText("Kế toán");
});

test("«⋯» có đủ 4 thao tác, Đổi trưởng phòng (ô chọn avatar) và Thêm/bớt thành viên (hộp chọn, chuyển người từ phòng khác)", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId(`org-menu-${ids.kt}`).click();
  for (const n of [
    "Đổi trưởng phòng",
    "Thêm / bớt thành viên",
    "Chuyển sang phòng cha khác",
    "Xoá phòng",
  ])
    await expect(page.getByRole("menuitem", { name: n })).toBeVisible();
  await page.getByTestId("org-menu-head").click();
  await page.getByTestId(`org-head-opt-${USER_ID.dung}`).check();
  await page.getByTestId("org-head-save").click();
  await expect(node(page, ids.kt).getByTestId("org-head")).toContainText("Dung Vo");
  await undo(page, "Đã đổi trưởng phòng").click();
  await expect(node(page, ids.kt).getByTestId("org-head")).toContainText("Chưa có trưởng phòng");
  // thêm người đang ở Kinh doanh vào Kế toán ⇒ CHUYỂN (mỗi người một phòng)
  await page.getByTestId(`org-menu-${ids.kt}`).click();
  await page.getByTestId("org-menu-members").click();
  await expect(page.getByTestId("org-members-edit-dialog")).toContainText("sẽ chuyển sang đây");
  await page.getByTestId(`org-member-opt-${USER_ID.lan}`).click();
  await page.getByTestId("org-members-save").click();
  const inKt = await withOwner(
    async (s) => s`select user_id from admin.group_members where group_id = ${ids.kt}`,
  );
  expect(inKt.map((r) => r.user_id)).toEqual([USER_ID.lan]);
  const inKd = await withOwner(
    async (s) => s`select user_id from admin.group_members where group_id = ${ids.kd}`,
  );
  expect(inKd.map((r) => r.user_id)).toEqual([USER_ID.an]);
  await undo(page, "Đã cập nhật thành viên").click();
  await expect
    .poll(
      async () =>
        (
          await withOwner(
            async (s) =>
              s`select 1 from admin.group_members where group_id = ${ids.kd} and user_id = ${USER_ID.lan}`,
          )
        ).length,
    )
    .toBe(1);
});

test("Chuyển phòng cha bằng menu (không chọn được con của chính nó), Hoàn tác trả phòng cha cũ", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId(`org-menu-${ids.kd}`).click();
  await page.getByTestId("org-menu-move").click();
  await expect(page.getByTestId(`org-parent-opt-${ids.hn}`)).toHaveCount(0); // con của chính nó
  await page.getByTestId(`org-parent-opt-${ids.kt}`).check();
  await page.getByTestId("org-move-save").click();
  await expect.poll(() => parentOf(ids.kd)).toBe(ids.kt);
  await undo(page, "Đã chuyển").click();
  await expect.poll(() => parentOf(ids.kd)).toBeNull();
});

test("máy tính: kéo thẻ thả lên phòng cha mới ⇒ chuyển, thả vào con của chính nó bị chặn (viền đỏ, không đổi), Hoàn tác", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId("org-drag-hint")).toBeVisible();
  await node(page, ids.trong).dragTo(node(page, ids.kt));
  await expect.poll(() => parentOf(ids.trong)).toBe(ids.kt);
  await undo(page, "Đã chuyển").click();
  await expect.poll(() => parentOf(ids.trong)).toBeNull();
  // kéo Kinh doanh thả lên con của nó (Hà Nội) ⇒ chặn
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`);
  });
  await node(page, ids.kd).dragTo(node(page, ids.hn));
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => ok()))); // một khung hình: bộ xử lý thả đã chạy (không ngủ chờ)
  expect(writes).toEqual([]); // UI chặn: không gửi lệnh ghi nào
  expect(await parentOf(ids.kd)).toBeNull();
});

test("Xoá: phòng còn người/phòng con ⇒ câu nghiệp vụ, không xoá, phòng trống ⇒ xác nhận rồi xoá, Hoàn tác tạo lại", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId(`org-menu-${ids.kd}`).click();
  await page.getByTestId("org-menu-delete").click();
  await expect(page.getByTestId("org-delete-blocked")).toContainText("phòng con");
  await page.getByRole("button", { name: "Đóng" }).click();
  await expect(node(page, ids.kd)).toBeVisible();
  await page.getByTestId(`org-menu-${ids.trong}`).click();
  await page.getByTestId("org-menu-delete").click();
  await page.getByRole("button", { name: "Xoá phòng", exact: true }).click();
  await expect(page.getByTestId("org-tree")).not.toContainText("Dự án trống");
  await undo(page, "Đã xoá phòng").click();
  await expect(page.getByTestId("org-tree")).toContainText("Dự án trống");
});

test("điện thoại: không có gợi ý kéo thả, thẻ không kéo được, vẫn có «⋯» đủ thao tác", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await expect(page.getByTestId("org-drag-hint")).toHaveCount(0);
  await expect(node(page, ids.kt)).not.toHaveAttribute("draggable", "true");
  await page.getByTestId(`org-menu-${ids.kt}`).click();
  await expect(page.getByRole("menuitem", { name: "Chuyển sang phòng cha khác" })).toBeVisible();
});

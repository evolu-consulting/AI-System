// CR-127 · J16 · Z8 · xoá HĐ NHÁP từ menu «Thao tác» (stack journey thật, công ty `e2e-par-<hậu tố>` có quy trình «Giám đốc duyệt»): người tạo (nhân viên) mở HĐ nháp ⇒ «Thao tác» ⇒
// «Xoá hợp đồng» ⇒ xác nhận ⇒ về danh sách + toast; người khác (không phải người tạo/phụ trách) không xoá được; HĐ ĐANG DUYỆT chỉ quản trị gói (Giám đốc) thấy mục.
import { uploadAndOpen } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";
import {
  apiAs,
  envOf,
  expect,
  HUB,
  loginCw,
  newPage,
  SPEC_TENANT,
  submitContract,
  U,
} from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j10);
const RUN = Date.now().toString(36);
const menu = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Thao tác/ });
const del = (page: import("@playwright/test").Page) =>
  page.getByRole("menuitem", { name: "Xoá hợp đồng" });
const getStatus = async (user: string, id: string): Promise<number> => {
  const s = await apiAs(E, user);
  return (await fetch(`${HUB}/pack/contracts/contracts/${id}`, { headers: s.headers })).status;
};

test("Người tạo xoá HĐ nháp: Thao tác ⇒ Xoá hợp đồng ⇒ xác nhận ⇒ về danh sách + toast", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  const id = await uploadAndOpen(page, E, `j16a-${RUN}`);
  await expect(menu(page)).toBeVisible({ timeout: 120_000 });
  await menu(page).click();
  await del(page).click();
  await page.getByTestId("delete-confirm").click();
  await expect(page).toHaveURL(/\/contracts\/list$/);
  await expect(page.getByText("Đã xoá hợp đồng")).toBeVisible();
  expect(await getStatus(U.employee, id)).toBe(404);
});

test("Người khác (không phải người tạo/phụ trách) không thấy «Xoá hợp đồng» ở HĐ nháp, gọi API cũng bị từ chối", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const emp = await newPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `j16b-${RUN}`);
  await expect(menu(emp)).toBeVisible({ timeout: 120_000 }); // người tạo có menu ⇒ trang đã tải xong
  // Trưởng phòng Kinh doanh (cùng phòng) và Trưởng phòng Kế toán (khác phòng): không phải người tạo/phụ trách ⇒ không có mục xoá
  for (const user of ["e2e-kd-truong", U.accounting]) {
    const other = await newPage(browser);
    await loginCw(other, E, user);
    await other.goto(`${E.cw}/contracts/c/${id}`);
    // trang đã tải xong: hiện trạng thái HĐ hoặc câu «không có quyền xem»
    await expect(
      other
        .getByTestId("status-chip")
        .or(other.getByText(/không có quyền xem/))
        .first(),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(menu(other)).toHaveCount(0);
  }
  const s = await apiAs(E, U.accounting);
  const r = await fetch(`${HUB}/pack/contracts/contracts/${id}`, {
    method: "DELETE",
    headers: { ...s.headers, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect([403, 404]).toContain(r.status);
  expect(await getStatus(U.employee, id)).toBe(200);
});

test("HĐ đang duyệt: người tạo không thấy «Xoá hợp đồng», quản trị gói (Giám đốc) thấy", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const id = await submitContract(browser, E, `j16c-${RUN}`);
  const emp = await newPage(browser);
  await loginCw(emp, E, U.employee);
  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("status-chip")).not.toHaveAttribute("data-status", "draft", {
    timeout: 60_000,
  });
  // CR-128 (e): người tạo có thể còn mục khác trong «Thao tác» (vd Rút về) ⇒ kiểm riêng mục «Xoá hợp đồng»
  if ((await menu(emp).count()) > 0) await menu(emp).click();
  await expect(del(emp)).toHaveCount(0);
  const dir = await newPage(browser);
  await loginCw(dir, E, U.director);
  await dir.goto(`${E.cw}/contracts/c/${id}`);
  await expect(menu(dir)).toBeVisible({ timeout: 60_000 });
  await menu(dir).click();
  await expect(del(dir)).toBeVisible();
});

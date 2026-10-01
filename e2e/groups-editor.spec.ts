// ADM-FR-62 · ADM-FR-55 · M3-R01, R02 · e2e tạo và sửa Group (test-plan E-GE). Nhãn nguyên văn plan-frontend §5.
import { expect, test } from "@playwright/test";
import {
  betaId,
  ID3,
  loginAs,
  loginUI,
  PW,
  resetFixture,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const KT = ID3.group.acmeKeToan;

test("ADM-FR-62 · M3-R01 · '+ Tạo group': key 'Ke Toan 2' → chuẩn hoá 'ke-toan-2'; điền Tên, Mô tả → 'Tạo group' → /groups/<uuid> + toast 'Đã tạo Kế toán 2'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/groups");
  await page.getByRole("link", { name: "+ Tạo group" }).click();
  await expect(page).toHaveURL(/\/groups\/new/);
  await expect(page.getByRole("heading", { level: 1, name: "Group mới" })).toBeVisible();
  const key = page.getByRole("textbox", { name: "Key", exact: true });
  await key.fill("Ke Toan 2");
  await expect(key).toHaveValue("ke-toan-2");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Kế toán 2");
  await page.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Nhóm kế toán thứ hai");
  const created = page.waitForResponse(
    (r) => r.url().includes("/admin/groups") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Tạo group" }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/);
  await expect(toast(page, "Đã tạo Kế toán 2")).toBeVisible();
});

test("ADM-FR-62 · M3-R01 · key trùng 'ke-toan' → 'Key đã được dùng trong tenant này'; key sai 'a' → 'Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự)'; không tạo group", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/groups/new");
  const key = page.getByRole("textbox", { name: "Key", exact: true });
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Trùng");
  await key.fill("a");
  await page.getByRole("button", { name: "Tạo group" }).click();
  await expect(
    page.getByText("Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự)"),
  ).toBeVisible();
  await key.fill("ke-toan");
  await page.getByRole("button", { name: "Tạo group" }).click();
  await expect(page.getByText("Key đã được dùng trong tenant này")).toBeVisible();
  await expect(page).toHaveURL(/\/groups\/new/);
  const n = await withOwner(async (sql) => {
    const [r] = await sql`select count(*)::int as n from admin.groups where key = 'ke-toan'`;
    return r?.n;
  });
  expect(n).toBe(2);
});

test("ADM-FR-62 · M3-R01 · editor ke-toan: heading 'Kế toán', 3 tab Thành viên/Feature/Agent; 'Đổi tên' → dialog chỉ có Tên và Mô tả (không Key); Lưu → toast 'Đã lưu Kế toán tổng hợp', tiêu đề đổi", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto(`/groups/${KT}`);
  await expect(page.getByRole("heading", { level: 1, name: "Kế toán" })).toBeVisible();
  for (const t of ["Thành viên", "Feature", "Agent"]) {
    await expect(page.getByRole("tab", { name: t, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đổi tên group" });
  await expect(dialog.getByRole("textbox", { name: "Key", exact: true })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Tên", exact: true }).fill("Kế toán tổng hợp");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu Kế toán tổng hợp")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Kế toán tổng hợp" })).toBeVisible();
});

test("ADM-FR-62 · M3-R02 · editor beta-testers: nhãn 'Thấy các feature đang Beta'; đổi tên được; menu ⋯ ở đầu trang KHÔNG có 'Xoá'", async ({
  page,
}) => {
  const beta = await withOwner((sql) => betaId(sql, "acme"));
  await loginAs(page, "acme", "binh");
  await page.goto(`/groups/${beta}`);
  await expect(page.getByText("Thấy các feature đang Beta")).toBeVisible();
  const more = page.getByRole("button", { name: "Thao tác khác" });
  if (await more.count()) {
    await more.first().click();
    await expect(page.getByRole("menuitem", { name: "Xoá", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đổi tên group" });
  await dialog.getByRole("textbox", { name: "Tên", exact: true }).fill("Beta nội bộ");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu Beta nội bộ")).toBeVisible();
});

test("ADM-FR-62 · M3-R24 · tab 'Agent': text 'Chưa khả dụng', không gọi API agent; đổi tab ghi ?tab= lên URL", async ({
  page,
}) => {
  const agentCalls: string[] = [];
  page.on("request", (r) => {
    if (/agent/i.test(new URL(r.url()).pathname)) agentCalls.push(r.url());
  });
  await loginAs(page, "acme", "binh");
  await page.goto(`/groups/${KT}`);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page).toHaveURL(/tab=agents/);
  await expect(page.getByText("Chưa khả dụng")).toBeVisible();
  await page.getByRole("tab", { name: "Feature", exact: true }).click();
  await expect(page).toHaveURL(/tab=features/);
  expect(agentCalls).toEqual([]);
});

test("ADM-BR-09 · M3-R06 · id lạ hoặc group tenant khác → trạng thái NotFound với lối 'Về danh sách' (không rò dữ liệu)", async ({
  page,
}) => {
  await loginAs(page, "globex", "hoa");
  await page.goto(`/groups/${KT}`);
  await expect(page.getByText("Về danh sách")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Kế toán" })).toHaveCount(0);
  await page.goto(`/groups/${ID3.unknown}`);
  await expect(page.getByText("Về danh sách")).toBeVisible();
});

test("ADM-FR-62 · M3-R06 · member (lan) không vào được /groups: không gọi /admin/groups", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/groups")) calls.push(r.url());
  });
  await loginUI(page, "acme", "lan", PW);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/groups");
  await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toHaveCount(0);
  expect(calls).toEqual([]);
});

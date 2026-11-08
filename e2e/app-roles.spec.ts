// CR-112 S5 · ADM-FR-80, ADM-FR-82 · ADM-BR-12, ADM-BR-16 · e2e Phân quyền › Vai theo ứng dụng: tạo vai → gán người → Lưu một lượt
// (platform_admin), 409 VERSION_CONFLICT ⇒ tải lại, Kiểm tra quyền ("quyền ngoài vai"), vai vượt trần "không hiệu lực",
// tenant_admin công ty mình. Fixture: gói `contracts` của acme dựng bằng SQL (DB e2e gốc không chạy migration gói; hành vi API vai đã
// phủ ở int `app-roles.service.int.test.ts`). Số liệu: lan ở nhóm phòng ban "Kế toán PB" (có contracts-read, ngoài vai); an ở 2 vai
// (Chỉ xem + Nhân viên); "Quản lý HĐ" là vai tuỳ biến (Sửa) chưa có người.
import { expect, type Page, test } from "@playwright/test";
import {
  loginAdmin,
  loginAs,
  resetFixture,
  TENANT_ID,
  toast,
  USER_ID,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });

const uid = (n: number) => `01900000-0000-7000-8000-00000000c1${String(n).padStart(2, "0")}`;
const F = { read: uid(1), write: uid(2), admin: uid(3) } as const;
const G = {
  viewer: uid(11),
  editor: uid(12),
  owner: uid(13),
  custom: uid(14),
  dept: uid(15),
} as const;
const R = { viewer: uid(21), editor: uid(22), owner: uid(23), custom: uid(24) } as const;
const A = TENANT_ID.acme;

async function seedContracts(): Promise<void> {
  await withOwner(async (sql) => {
    for (const a of ["read", "write", "admin"] as const) {
      await sql`insert into admin.features (id, key, name, description, icon, status)
        values (${F[a]}, ${`contracts-${a}`}, ${sql.json({ vi: `Hợp đồng ${a}` })}, ${sql.json({})}, 'package', 'on')`;
      await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${F[a]}, ${A})`;
    }
    const groups: [string, string, string][] = [
      [G.viewer, "contracts-viewer", "Chỉ xem"],
      [G.editor, "contracts-editor", "Nhân viên"],
      [G.owner, "contracts-owner", "Toàn quyền"],
      [G.custom, "contracts-quan-ly", "Quản lý HĐ"],
      [G.dept, "pb-ke-toan", "Kế toán PB"],
    ];
    for (const [id, key, vi] of groups) {
      await sql`insert into admin.groups (id, tenant_id, key, name, description)
        values (${id}, ${A}, ${key}, ${sql.json({ vi })}, null)`;
    }
    const roles: [string, string, string, string, string, boolean][] = [
      [R.viewer, "viewer", "Chỉ xem", "read", G.viewer, true],
      [R.editor, "editor", "Nhân viên", "write", G.editor, true],
      [R.owner, "owner", "Toàn quyền", "admin", G.owner, true],
      [R.custom, "quan-ly", "Quản lý HĐ", "write", G.custom, false],
    ];
    for (const [id, key, vi, level, group, def] of roles) {
      await sql`insert into admin.app_roles (id, tenant_id, pack, key, name, level, group_id, is_default)
        values (${id}, ${A}, 'contracts', ${key}, ${sql.json({ vi })}, ${level}, ${group}, ${def})`;
    }
    const grants: [string, string][] = [
      [G.viewer, "read"],
      [G.editor, "read"],
      [G.editor, "write"],
      [G.owner, "read"],
      [G.owner, "write"],
      [G.owner, "admin"],
      [G.custom, "read"],
      [G.custom, "write"],
      [G.dept, "read"],
    ];
    for (const [i, [g, a]] of grants.entries()) {
      await sql`insert into admin.feature_grants (id, tenant_id, feature_id, group_id)
        values (${uid(40 + i)}, ${A}, ${F[a as keyof typeof F]}, ${g})`;
    }
    const members: [string, string][] = [
      [G.viewer, USER_ID.an],
      [G.editor, USER_ID.an],
      [G.dept, USER_ID.lan],
    ];
    for (const [g, u] of members) {
      await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${A}, ${g}, ${u})`;
    }
  });
}

test.beforeEach(async () => {
  resetFixture();
  await seedContracts();
});

const block = (page: Page) => page.getByRole("region", { name: "Ứng dụng Hợp đồng" });
const rolesTable = (page: Page) => block(page).getByRole("table", { name: "Vai của Hợp đồng" });
const roleRow = (page: Page, name: string) =>
  rolesTable(page).getByRole("row").filter({ hasText: name });
const userRow = (page: Page, username: string) =>
  page
    .getByRole("table", { name: "Gán người dùng vào vai" })
    .getByRole("row")
    .filter({ has: page.getByText(username, { exact: true }) });
const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const saveBtn = (page: Page) => page.getByRole("button", { name: "Lưu", exact: true });

const dbRole = (key: string) =>
  withOwner(async (sql) => {
    const rows = await sql`select r.level, r.name, r.group_id from admin.app_roles r
      where r.tenant_id = ${A} and r.pack = 'contracts' and r.key = ${key}`;
    return rows[0] as { level: string; name: { vi: string }; group_id: string } | undefined;
  });
const memberIds = (groupId: string) =>
  withOwner(async (sql) =>
    (await sql`select user_id from admin.group_members where group_id = ${groupId}`).map(
      (r) => r.user_id as string,
    ),
  );

test("ADM-FR-80 · ADM-FR-82 · platform_admin: 3 vai mặc định không sửa/xoá; tạo vai 'Kế toán HĐ' (Sửa) + gán lan → 2 thay đổi chưa lưu → Lưu một lượt → Group + grant + thành viên đúng, 'Quyền thực tế' Sửa", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/access?tenant=acme");
  await expect(page.getByRole("heading", { level: 2, name: "Phân quyền" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Vai theo ứng dụng", selected: true })).toBeVisible();
  for (const n of ["Toàn quyền", "Nhân viên", "Chỉ xem", "Quản lý HĐ"]) {
    await expect(roleRow(page, n)).toBeVisible();
  }
  await expect(page.getByText("Mức cao nhất công ty cho phép: Quản trị")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sửa vai Toàn quyền" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xoá vai Toàn quyền" })).toHaveCount(0);
  await expect(status(page, "Không có thay đổi")).toBeVisible();

  await block(page).getByRole("button", { name: "Tạo vai" }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo vai · Hợp đồng" });
  await dialog.getByLabel("Tên vai").fill("Kế toán HĐ");
  await dialog.getByLabel("Mức").selectOption({ label: "Sửa" });
  await dialog.getByRole("button", { name: "Tạo vai" }).click();
  await expect(roleRow(page, "Kế toán HĐ")).toContainText("Mới");
  await expect(status(page, "1 thay đổi chưa lưu")).toBeVisible();

  await userRow(page, "lan")
    .getByRole("combobox", { name: "Gán vai cho lan" })
    .selectOption({ label: "Kế toán HĐ · Hợp đồng" });
  await expect(status(page, "2 thay đổi chưa lưu")).toBeVisible();
  await expect(userRow(page, "lan")).toContainText("Hợp đồng: Sửa");
  await expect(roleRow(page, "Kế toán HĐ")).toContainText("1 người");
  // Ảnh chụp cho báo cáo lát (chỉ khi đặt RBAC_SHOT=<đường dẫn .png>); không ảnh hưởng chạy thường.
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e
  const shot = process.env.RBAC_SHOT;
  if (shot) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: shot });
    await page.screenshot({ path: shot.replace(/\.png$/, "-full.png"), fullPage: true });
  }

  await saveBtn(page).click();
  await expect(toast(page, "Đã lưu 2 thay đổi")).toBeVisible();
  await expect(status(page, "Không có thay đổi")).toBeVisible();

  const rows = await withOwner(
    (sql) => sql`select r.key, r.level, r.group_id, r.is_default from admin.app_roles r
      where r.tenant_id = ${A} and r.name->>'vi' = 'Kế toán HĐ'`,
  );
  expect(rows).toHaveLength(1);
  const created = rows[0] as { level: string; group_id: string; is_default: boolean };
  expect([created.level, created.is_default]).toEqual(["write", false]);
  expect(await memberIds(created.group_id)).toEqual([USER_ID.lan]);
  const codes = await withOwner(async (sql) =>
    (
      await sql`select f.key from admin.feature_grants fg join admin.features f on f.id = fg.feature_id
          where fg.group_id = ${created.group_id} order by 1`
    ).map((r) => r.key as string),
  );
  expect(codes).toEqual(["contracts-read", "contracts-write"]);
  await expect(userRow(page, "lan")).toContainText("Kế toán HĐ · Hợp đồng");
});

test("ADM-FR-82 AC2 · an ở 2 vai cùng app (Chỉ xem + Nhân viên) ⇒ quyền thực tế = mức cao nhất (Sửa); gỡ vai Nhân viên (chưa lưu) ⇒ Xem; Huỷ bỏ thay đổi ⇒ về Sửa", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/access?tenant=acme");
  const an = userRow(page, "an");
  await expect(an).toContainText("Hợp đồng: Sửa");
  await an.getByRole("button", { name: "Gỡ an khỏi vai Nhân viên · Hợp đồng" }).click();
  await expect(an).toContainText("Hợp đồng: Xem");
  await expect(status(page, "1 thay đổi chưa lưu")).toBeVisible();
  await page.getByRole("button", { name: "Bỏ thay đổi" }).click();
  await expect(an).toContainText("Hợp đồng: Sửa");
  await expect(status(page, "Không có thay đổi")).toBeVisible();
  expect(await memberIds(G.editor)).toEqual([USER_ID.an]);
});

test("ADM-FR-82 AC5 · Kiểm tra quyền của lan: Xem 'qua nhóm Kế toán PB' kèm nhãn 'quyền ngoài vai' (không phải vai); của an: Sửa 'qua vai Nhân viên'", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/access?tenant=acme");
  await userRow(page, "lan").getByRole("button", { name: "Kiểm tra quyền của lan" }).click();
  const lan = page.getByRole("dialog", { name: "Kiểm tra quyền · Lan Tran" });
  const sec = lan.getByRole("region", { name: "Hợp đồng" });
  await expect(sec.getByText("Xem", { exact: true }).first()).toBeVisible();
  await expect(sec.getByText("Qua nhóm Kế toán PB")).toBeVisible();
  await expect(sec.getByText("quyền ngoài vai")).toBeVisible();
  await expect(sec.getByText(/Qua vai/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await userRow(page, "an").getByRole("button", { name: "Kiểm tra quyền của an" }).click();
  const an = page.getByRole("dialog", { name: "Kiểm tra quyền · An Nguyen" });
  const anSec = an.getByRole("region", { name: "Hợp đồng" });
  await expect(anSec.getByText("Qua vai Nhân viên")).toBeVisible();
  await expect(anSec.getByText("Qua vai Chỉ xem")).toBeVisible();
  await expect(anSec.getByText("quyền ngoài vai")).toHaveCount(0);
});

test("ADM-BR-12 · công ty chỉ có entitlement tới Sửa ⇒ vai Toàn quyền (Quản trị) 'không hiệu lực'; an (Chỉ xem + Nhân viên) vẫn Sửa", async ({
  page,
}) => {
  await withOwner(
    (sql) => sql`update admin.feature_entitlements set revoked_at = now()
      where tenant_id = ${A} and feature_id = ${F.admin}`,
  );
  await loginAdmin(page);
  await page.goto("/access?tenant=acme");
  await expect(page.getByText("Mức cao nhất công ty cho phép: Sửa")).toBeVisible();
  await expect(roleRow(page, "Toàn quyền")).toContainText("không hiệu lực");
  await expect(roleRow(page, "Nhân viên")).not.toContainText("không hiệu lực");
  await expect(userRow(page, "an")).toContainText("Hợp đồng: Sửa");
});

test("ADM-FR-80 · 409 VERSION_CONFLICT: vai đổi ở nơi khác trong lúc sửa mức ⇒ Lưu báo 'đã được thay đổi ở nơi khác', tải lại và bỏ nháp; DB giữ mức của người kia", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/access?tenant=acme");
  await page.getByRole("button", { name: "Sửa vai Quản lý HĐ" }).click();
  const dialog = page.getByRole("dialog", { name: "Sửa vai · Hợp đồng" });
  await dialog.getByLabel("Mức").selectOption({ label: "Quản trị" });
  await dialog.getByRole("button", { name: "Áp dụng" }).click();
  await expect(status(page, "1 thay đổi chưa lưu")).toBeVisible();
  await expect(roleRow(page, "Quản lý HĐ")).toContainText("Đã sửa");

  await withOwner(
    (sql) =>
      sql`update admin.app_roles set version = version + 1, level = 'read' where id = ${R.custom}`,
  );
  await saveBtn(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /đã được thay đổi ở nơi khác/ }),
  ).toBeVisible();
  await expect(status(page, "Không có thay đổi")).toBeVisible();
  await expect(roleRow(page, "Quản lý HĐ")).not.toContainText("Đã sửa");
  expect((await dbRole("quan-ly"))?.level).toBe("read");
});

test("ADM-FR-77 · ADM-FR-80 · ADM-FR-82 · tenant_admin (binh, acme): thấy vai công ty mình không cần chọn tenant; gán thu vào vai tuỳ biến → Lưu; xoá vai tuỳ biến còn người bị khoá, vai trống xoá được; chỉ người dùng nội bộ (kind=internal)", async ({
  page,
}) => {
  const userCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/admin/users") userCalls.push(r.url());
  });
  await loginAs(page, "acme", "binh");
  await page.goto("/access");
  await expect(roleRow(page, "Quản lý HĐ")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);

  await userRow(page, "thu")
    .getByRole("combobox", { name: "Gán vai cho thu" })
    .selectOption({ label: "Quản lý HĐ · Hợp đồng" });
  await expect(status(page, "1 thay đổi chưa lưu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xoá vai Quản lý HĐ" })).toBeDisabled();
  await saveBtn(page).click();
  await expect(toast(page, "Đã lưu 1 thay đổi")).toBeVisible();
  expect(await memberIds(G.custom)).toEqual([USER_ID.thu]);
  expect(userCalls.some((u) => new URL(u).searchParams.get("kind") === "internal")).toBe(true);

  await expect(page.getByRole("button", { name: "Xoá vai Quản lý HĐ" })).toBeDisabled(); // còn 1 người đã lưu
  await userRow(page, "thu")
    .getByRole("button", { name: /Gỡ thu khỏi vai Quản lý HĐ/ })
    .click();
  await expect(page.getByRole("button", { name: "Xoá vai Quản lý HĐ" })).toBeEnabled();
  await page.getByRole("button", { name: "Xoá vai Quản lý HĐ" }).click();
  await expect(roleRow(page, "Quản lý HĐ")).toContainText("Sẽ xoá");
  await expect(status(page, "2 thay đổi chưa lưu")).toBeVisible();
  await saveBtn(page).click(); // gỡ người rồi mới xoá vai (không dính 409 ROLE_HAS_MEMBERS)
  await expect(toast(page, "Đã lưu 2 thay đổi")).toBeVisible();
  await expect(roleRow(page, "Quản lý HĐ")).toHaveCount(0);
  expect(await dbRole("quan-ly")).toBeUndefined();
});

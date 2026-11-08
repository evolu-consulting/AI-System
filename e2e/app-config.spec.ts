// CR-118 · cr118-app-config · e2e trang cấu hình app /apps/$appKey (ADM-FR-84, ADM-FR-85): F1 bật app cho công ty từ trang app (ngăn "Công ty" dùng chung
// AppCard + một đường lưu với trang công ty) ⇒ xem trước bản nháp ⇒ lưu ⇒ bảng phản ánh; F2 tab Quy trình (root e2e không có Hub ⇒ trạng thái rỗng có hướng dẫn;
// luồng nhân bản/gán chạy cùng hook với trang công ty, phủ ở job Hub); F3 "công ty X đang thấy gì" theo vai (đối tác không thấy nhóm Sổ Hợp Tác);
// F4 tenant_admin xem chỉ-đọc ở trang công ty, không vào được trang cấu hình app. admin-api + DB e2e THẬT; riêng `/packs*` giả (support/fake-packs.ts).
import { expect, test } from "@playwright/test";
import { fakePacks } from "./support/fake-packs";
import { loginAdmin, loginAs, resetFixture, TENANT_ID, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });

const KEYS = ["contracts-read", "contracts-write", "contracts-admin", "han-muc-duyet"];

test.beforeAll(async () => {
  resetFixture();
  await withOwner(async (sql) => {
    for (const key of KEYS) {
      await sql`insert into admin.features (key, name, status)
        values (${key}, ${sql.json({ vi: key })}, 'on') on conflict (key) do nothing`;
    }
  });
});
test.afterAll(() => resetFixture());

const LEVEL_KEYS = KEYS.slice(0, 3);
/** Server thật bật gói `?level=L` ⇒ cấp entitlement tới mức L; tắt ⇒ thu hồi cả 3. */
const sync = (key: string, on: boolean, level: "read" | "write" | "admin") =>
  withOwner(async (sql) => {
    if (key !== "contracts") return;
    const upTo = LEVEL_KEYS.slice(0, ["read", "write", "admin"].indexOf(level) + 1);
    await (on
      ? sql`insert into admin.feature_entitlements (feature_id, tenant_id)
          select f.id, t.id from admin.features f, admin.tenants t
          where f.key = any(${upTo}) and t.key = 'acme'
          on conflict (feature_id, tenant_id) do update set revoked_at = null`
      : sql`update admin.feature_entitlements set revoked_at = now()
          where tenant_id = (select id from admin.tenants where key = 'acme')
            and feature_id in (select id from admin.features where key = any(${LEVEL_KEYS}))
            and revoked_at is null`);
  });

const acmeKeys = () =>
  withOwner(async (sql) => {
    const rows = await sql`select f.key from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id
      join admin.tenants t on t.id = e.tenant_id
      where t.key = 'acme' and e.revoked_at is null and f.key = any(${KEYS}) order by f.key`;
    return rows.map((r) => r.key as string);
  });

const TABS = ["Tổng quan", "Tính năng", "Xem trước"]; // CR-121 c13: tab Quy trình/Công ty gán đã gỡ
const acmeRow = (page: import("@playwright/test").Page) =>
  page.getByRole("row").filter({ has: page.getByText("acme", { exact: true }) });

// CR-121 c13: mức theo công ty KHÔNG sửa ở trang app nữa (chỉ ở Công ty › Ứng dụng, đã phủ bởi feature-ui.spec.ts) ⇒ cần viết lại, tạm treo.
test.fixme("CR-118 · F1 · /apps → Sổ Hợp Tác: 5 tab, tab Công ty → acme → mức Sửa → Xem trước bản nháp (quản trị công ty thấy 'Tạo và sửa hợp đồng') → quay lại Lưu ⇒ bảng phản ánh", async ({
  page,
}) => {
  const calls = await fakePacks(page, TENANT_ID.acme, {}, sync);
  await loginAdmin(page);
  await page.goto("/apps");
  await page.getByRole("row", { name: /Sổ Hợp Tác/ }).click();
  await page.getByRole("link", { name: "Mở trang chi tiết" }).click();
  await expect(page).toHaveURL(/\/apps\/contracts/);
  await expect(page.getByRole("heading", { level: 1, name: "Sổ Hợp Tác" })).toBeVisible();
  for (const name of TABS) await expect(page.getByRole("tab", { name })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: "Công ty" }).click();
  await expect(acmeRow(page)).toContainText("Tắt");
  await acmeRow(page)
    .getByRole("button", { name: /Mở cấu hình của/ })
    .click();
  const drawer = page.getByRole("complementary", { name: "Cấu hình công ty đang chọn" });
  const card = drawer.getByTestId("apps-row-contracts"); // CR-121 c12: hàng của bảng ứng dụng
  await expect(card.getByRole("radio", { name: "Tắt" })).toBeChecked();
  await card
    .getByRole("radiogroup", { name: "Mức dùng Sổ Hợp Tác" })
    .getByRole("radio", { name: "Sửa" })
    .click();
  await expect(drawer.getByText("Chưa lưu: cấp 2, thu hồi 0 · bật 1 gói, tắt 0 gói")).toBeVisible();

  await drawer.getByRole("button", { name: "Xem trước công ty này sẽ thấy gì" }).click();
  await expect(page.getByRole("tab", { name: "Xem trước" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("radio", { name: "Nháp" })).toBeChecked();
  const admin = page.getByTestId("preview-company_admin");
  await page.getByRole("radio", { name: "Quản trị công ty" }).click();
  await expect(
    admin.locator('li[data-visible="true"]').filter({ hasText: "Tạo và sửa hợp đồng" }),
  ).toBeVisible();
  await expect(
    admin.locator('li[data-visible="false"]').filter({ hasText: "Quản lý mẫu hợp đồng" }),
  ).toContainText("Cần mức Quản trị");
  expect(await acmeKeys()).toEqual([]); // xem trước KHÔNG ghi gì

  await page.getByRole("tab", { name: "Công ty" }).click();
  await expect(card.getByRole("radio", { name: "Sửa" })).toBeChecked(); // bản nháp còn nguyên sau khi đổi tab
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click(); // chỉ bật/cấp ⇒ không hỏi xác nhận
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  expect(calls).toEqual(["PUT contracts"]);
  expect(await acmeKeys()).toEqual(["contracts-read", "contracts-write"]);
  await expect(acmeRow(page)).toContainText("Sửa");
  // cùng đường lưu: trang công ty thấy đúng mức đó
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=features`);
  await expect(
    page.getByTestId("apps-row-contracts").getByRole("radio", { name: "Sửa" }),
  ).toBeChecked();
  // CR-121 c12: bảng ứng dụng không còn lối tắt "Mở cấu hình app" (App chỉ link sang Công ty › Quy trình — c13).
});

test("CR-121 · c13 · /apps/contracts?tab=processes cũ ⇒ Tổng quan + thông báo Gán quy trình ở trang Công ty, không còn điều khiển gán", async ({
  page,
}) => {
  await fakePacks(page, TENANT_ID.acme);
  await sync("contracts", true, "read"); // có công ty đang dùng app ⇒ thông báo có link tới Quy trình của công ty đó
  await loginAdmin(page);
  await page.goto("/apps/contracts?tab=processes");
  const note = page.getByTestId("app-assign-note");
  await expect(note).toContainText("Gán quy trình ở trang Công ty");
  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Quy trình" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Công ty" })).toHaveCount(0);
  await expect(page.getByTestId("admin-assign-pick")).toHaveCount(0);
  await note
    .getByRole("link", { name: /Quy trình của/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tenants\/[^/]+\?tab=processes|\/tenants\/[^/]+.*tab=processes/);
});

test("CR-118 · F3 · Xem trước acme: đối tác không thấy nhóm Sổ Hợp Tác, thành viên thấy mục theo mức Sửa, 'Duyệt theo quy trình' không cần tính năng thêm (CR-121 D-4)", async ({
  page,
}) => {
  await fakePacks(page, TENANT_ID.acme);
  await sync("contracts", true, "write"); // acme dùng Sổ Hợp Tác ở mức Sửa (điều kiện của phép xem trước)
  await loginAdmin(page);
  await page.goto("/apps/contracts?tab=preview");
  await expect(page.getByText("Chọn một công ty để xem họ thấy gì.")).toBeVisible();
  await page.getByRole("combobox", { name: "Công ty cần xem" }).click();
  await page.getByRole("option").filter({ hasText: /acme/i }).first().click();

  await page.getByRole("radio", { name: "Đối tác" }).click();
  const partner = page.getByTestId("preview-partner");
  await expect(partner.getByText("Không hiện nhóm Sổ Hợp Tác trong menu.")).toBeVisible();
  await expect(partner.getByText("Đối tác không bao giờ thấy").first()).toBeVisible();
  await expect(partner.locator('[data-visible="true"]')).toHaveCount(0);

  await page.getByRole("radio", { name: "Thành viên" }).click();
  const member = page.getByTestId("preview-member");
  await expect(member.locator('li[data-visible="true"]').first()).toBeVisible();
  // CR-121 D-4: không còn add-on `contracts-approval-engine` ⇒ hành động duyệt theo quy trình hiện ngay ở mức Sửa; khe duyệt chạy (không còn "Cần bật tính năng thêm")
  const approveRow = member
    .locator('li[data-visible="true"]')
    .filter({ hasText: "Duyệt theo quy trình nhiều bước" });
  await expect(approveRow).toBeVisible();
  // mục "Hợp đồng đối tác gửi" vẫn đòi add-on gửi đối tác (đúng sản phẩm) ⇒ chỉ khẳng định riêng hành động duyệt không đòi tính năng thêm
  await expect(approveRow.getByText("Cần bật tính năng thêm")).toHaveCount(0);
  await expect(member.getByTestId("preview-slot-contracts.approval")).toContainText("Đang chạy");
  await expect(member.getByText("Chỉ quản trị công ty thấy").first()).toBeVisible();
});

test("CR-118 · F4 · tenant_admin (binh) xem thẻ app chỉ-đọc ở trang công ty mình: không có nút Lưu/liên kết cấu hình, /apps/contracts báo chỉ dành cho quản trị nền tảng", async ({
  page,
}) => {
  await fakePacks(page, TENANT_ID.acme);
  await loginAs(page, "acme", "binh");
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=features`);
  await expect(page.getByTestId("apps-row-contracts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mở cấu hình app" })).toHaveCount(0);
  await page.goto("/apps/contracts");
  await expect(page.getByText(/chỉ dành cho quản trị nền tảng/)).toBeVisible();
});

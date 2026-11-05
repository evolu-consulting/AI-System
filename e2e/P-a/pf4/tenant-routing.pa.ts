// CR-118 §11.2 · cr118-tenant-settings · e2e P-a PF4: platform_admin mở trang công ty acme › tab Tính năng › khe "contracts.approval" ›
// "Quy trình được gán & luật…": gán thêm một quy trình đã xuất bản; bỏ gán quy trình đang được luật dùng ⇒ 409 nêu luật bị ảnh hưởng.
// Hub routing + khe/thư viện giả bằng `page.route` (stack P-a chưa có hai quy trình đã xuất bản cùng khe); cần acme đang bật gói contracts.
// VIẾT, CHƯA CHẠY (e2e chạy cuối đợt). Việc chọn quy trình thật khi launch: int hub `routing-launch.int.test.ts`.
import { expect, type Page, test } from "@playwright/test";
import { fakePacks } from "../../support/fake-packs";
import { seedAdmin } from "../../support/helpers";
import { ACME, ADMIN_URL, settle } from "../_pa-support";

test.afterEach(() => settle());

const SLOT = "contracts.approval";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const D1 = "33333333-3333-4333-8333-333333333333";

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("platform gán quy trình vào tập của tenant và bỏ gán quy trình đang được luật dùng bị 409 nêu luật", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const assigned = [{ def_id: P1, name: "Mặc định", rel_version: 1 }];
    const calls: string[] = [];
    await p.route(`**/tenants/${ACME}/process-routing/${SLOT}/processes/*`, (r) => {
      const m = r.request().method();
      const id = r.request().url().split("/").pop() ?? "";
      calls.push(`${m} ${id}`);
      if (m === "PUT") {
        assigned.push({ def_id: id, name: "Duyệt nhanh", rel_version: 2 });
        return json(r, 200, {});
      }
      return json(r, 409, {
        error: {
          code: "ROUTING_PROCESS_IN_USE",
          message: "in use",
          details: {
            rules: [
              { id: "x", priority: 0 },
              { id: "y", priority: 2 },
            ],
          },
        },
      });
    });
    await p.route(`**/tenants/${ACME}/process-routing/${SLOT}`, (r) =>
      json(r, 200, {
        slot: SLOT,
        version: 1,
        rules: [
          {
            id: "x",
            priority: 0,
            condition: { departmentIds: [D1] },
            def_id: P1,
            is_default: false,
          },
        ],
        processes: assigned,
        current_def_id: P1,
        current_def_name: "Mặc định",
      }),
    );
    await p.route(`**/process-defs?*`, (r) =>
      json(r, 200, {
        items: [
          { id: P1, name: "Mặc định", slot: SLOT, published_version: 1, enabled: true },
          { id: P2, name: "Duyệt nhanh", slot: SLOT, published_version: 2, enabled: true },
        ],
        next_cursor: null,
      }),
    );
    // DB e2e của stack P-a không chạy migration gói ⇒ `/admin/tenants/:id/packs` trả 500 và tab Tính năng chỉ hiện lỗi: dùng backend gói giả chung.
    await fakePacks(p, ACME, { enabled: true });
    await platformLogin(p);
    await p.goto(`${ADMIN_URL}/tenants/${ACME}?tab=features`);
    const details = p.getByTestId(`admin-routing-details-${SLOT}`);
    await details.getByText("Quy trình được gán & luật chọn theo phòng ban").click();
    // hub-routing-backfill · quy trình chạy khi không có luật (gán cũ) gắn nhãn "Đang dùng".
    await expect(details.getByTestId(`admin-assigned-in-use-${P1}`)).toHaveText("Đang dùng");

    await details.getByTestId("admin-assign-pick").selectOption(P2);
    await details.getByTestId("admin-assign-add").click();
    await expect.poll(() => calls).toContain(`PUT ${P2}`);

    await details
      .getByTestId(`admin-assigned-${P1}`)
      .getByRole("button", { name: "Bỏ gán" })
      .click();
    await expect(details.getByTestId("admin-assign-error")).toContainText("luật số 1, 3");
  } finally {
    await ctx.close();
  }
});

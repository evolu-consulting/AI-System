// CR-105 L4 · Cài đặt › Quy trình duyệt chỉ ĐỌC: "đang dùng: <tên> · v<N>", sơ đồ bước, xem trước đường đi, không có form sửa/Lưu;
// lối vào ai-admin chỉ hiện cho platform_admin. Backend giả `page.route` (hình GET mới của design.md §4). VIẾT, CHƯA CHẠY (e2e chạy cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const FLOW = {
  def_id: "11111111-1111-4111-8111-111111111111",
  name: "Quy trình HĐ mặc định",
  rel_version: 4,
  is_default: true,
  steps: [
    {
      name: "Soạn & kiểm tra",
      department_name: "Kinh doanh",
      kind: "review",
      when: null,
    },
    {
      name: "Giám đốc duyệt",
      department_name: "Ban giám đốc",
      kind: "review",
      when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100 }] },
    },
  ],
};

async function install(page: Page, role: "tenant_admin" | "platform_admin") {
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const grant = { ...d.grant, user: { ...d.grant.user, role } };
  await page.route("**/auth/refresh", (r) => json(r, 200, grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/esign/settings", (r) =>
    json(r, 200, { configured: false, enabled: false, provider: null, demo: false, providers: [] }),
  );
  const puts: string[] = [];
  await page.route("**/pack/contracts/approval-flow", (r) => {
    if (r.request().method() !== "GET") puts.push(r.request().method());
    return json(r, 200, FLOW);
  });
  return puts;
}

async function open(page: Page) {
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  return dlg;
}

test("Cài đặt hiện quy trình đang dùng, không có form sửa", async ({ page }) => {
  const writes = await install(page, "tenant_admin");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-current-title")).toHaveText(
    "Quy trình duyệt đang dùng: Quy trình HĐ mặc định · v4",
  );
  await expect(dlg.getByTestId("flow-diagram").getByRole("listitem")).toHaveCount(2);
  // không form sửa: không nút thêm bước/lưu, không ô nhập tên bước
  await expect(dlg.getByRole("button", { name: /Thêm bước|Lưu quy trình/ })).toHaveCount(0);
  await expect(dlg.getByLabel("Tên bước")).toHaveCount(0);
  // người không phải platform_admin không thấy lối vào ai-admin
  await expect(dlg.getByTestId("flow-editor-link")).toHaveCount(0);
  // xem trước: giá trị 50 ⇒ bước 2 bị bỏ qua; 500 ⇒ chạy
  await dlg.getByLabel("Giá trị mẫu").fill("50");
  await expect(dlg.getByTestId("flow-preview").getByRole("listitem").nth(1)).toHaveAttribute(
    "data-run",
    "false",
  );
  await dlg.getByLabel("Giá trị mẫu").fill("500");
  await expect(dlg.getByTestId("flow-preview").getByRole("listitem").nth(1)).toHaveAttribute(
    "data-run",
    "true",
  );
  expect(writes).toEqual([]);
});

test("platform_admin thấy lối vào ai-admin ở Cài đặt", async ({ page }) => {
  await install(page, "platform_admin");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-editor-link")).toHaveText("Chỉnh quy trình duyệt");
});

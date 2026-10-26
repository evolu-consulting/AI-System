// contract-flow S5 · Cài đặt › Quy trình duyệt: danh sách bước, thêm bước, điều kiện, xem trước đường đi, Lưu ⇒ PUT, lỗi server theo trường,
// viewer chỉ xem. Backend giả `page.route`.
import { expect, type Page, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const review = (key: string, name: string, dept: string, when: unknown = null) => ({
  kind: "review",
  key,
  name,
  department_group_id: dept,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when,
});
const FLOW = {
  version: 1,
  is_default: true,
  updated_at: null,
  steps: [
    review("s0", "Soạn & kiểm tra", D1),
    review("s1", "Kế toán", D2, {
      op: "and",
      conds: [{ field: "total_value", op: "ge", value: 100000000 }],
    }),
  ],
};

async function install(page: Page, role: Role, putStatus = 200, code = "APPROVAL_FLOW_INVALID") {
  const d = asHub(role);
  const puts: unknown[] = [];
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  // Menu Cài đặt chỉ hiện cho vai ≠ viewer hoặc quản trị công ty (`canSeeSettings`) ⇒ viewer của gói vào bằng tài khoản tenant_admin.
  const grant = { ...d.grant, user: { ...d.grant.user, role: "tenant_admin" } };
  await page.route("**/auth/refresh", (r) => json(r, 200, grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  // S4: phòng ban lấy từ `/pack/contracts/groups` (không còn `/admin/org`).
  await page.route("**/pack/contracts/groups", (r) =>
    json(r, 200, [
      { id: D1, name: "Kinh doanh" },
      { id: D2, name: "Kế toán" },
    ]),
  );
  // cf-dify: catalog workflow Dify của tenant cho "Thêm bước Dify" (chỉ owner gọi).
  await page.route("**/pack/contracts/dify-workflows", (r) =>
    json(r, 200, { items: [{ key: "risk-scan", name: "Quét rủi ro hợp đồng" }] }),
  );
  await page.route("**/pack/contracts/approval-flow", (r) => {
    if (r.request().method() === "PUT") {
      const body = r.request().postDataJSON();
      puts.push(body);
      if (putStatus === 409)
        return json(r, 409, {
          error: {
            code: "VERSION_CONFLICT",
            message: "x",
            details: { current: { ...FLOW, version: 2 } },
          },
        });
      if (putStatus !== 200)
        return json(r, putStatus, {
          error: {
            code,
            message: "bad",
            details: { issues: [{ path: "steps.1.due_h", rule: "DUE_RANGE" }] },
          },
        });
      return json(r, 200, {
        version: 2,
        is_default: false,
        steps: body.steps,
        updated_at: "2026-10-23T00:00:00.000Z",
      });
    }
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

test("owner: thấy huy hiệu mặc định, thêm bước, xem trước, Lưu gửi PUT", async ({ page }) => {
  const puts = await install(page, "owner");
  const dlg = await open(page);
  await expect(dlg.getByText("Dùng mặc định", { exact: true })).toBeVisible();
  await expect(dlg.getByTestId("flow-step-1")).toBeVisible();

  // xem trước: giá trị trống vẫn cần Kế toán; 50 triệu thì bỏ qua
  await expect(dlg.getByTestId("flow-preview").locator("li[data-run=true]")).toHaveCount(2);
  await dlg.getByLabel("Giá trị mẫu").fill("50000000");
  await expect(dlg.getByTestId("flow-preview").locator("li[data-run=true]")).toHaveCount(1);

  await dlg.getByRole("button", { name: "Thêm bước duyệt" }).click();
  const step = dlg.getByTestId("flow-step-2");
  await step.getByLabel("Tên bước").fill("Pháp chế");
  await step.getByLabel("Phòng ban").selectOption(D1);
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect((puts[0] as { steps: unknown[]; version: number }).steps).toHaveLength(3);
  expect((puts[0] as { version: number }).version).toBe(1);
  await expect(dlg.getByText("Dùng mặc định", { exact: true })).toHaveCount(0);
});

test("owner: Thêm bước Dify chọn từ catalog ⇒ bước Dify vào luồng, Lưu gửi workflow_key", async ({
  page,
}) => {
  const puts = await install(page, "owner");
  const dlg = await open(page);
  const add = dlg.getByTestId("flow-dify-add");
  await expect(add.getByRole("button", { name: "Thêm bước Dify" })).toBeDisabled();
  await add.getByLabel("Thêm bước Dify").selectOption("risk-scan");
  await add.getByRole("button", { name: "Thêm bước Dify" }).click();
  await expect(dlg.getByTestId("flow-step-2")).toContainText("Quét rủi ro hợp đồng");
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect.poll(() => puts.length).toBe(1);
  const steps = (puts[0] as { steps: { kind: string; workflow_key?: string }[] }).steps;
  expect(steps[2]).toMatchObject({ kind: "dify", workflow_key: "risk-scan", after: "auto" });
});

test("viewer: không thấy Thêm bước Dify", async ({ page }) => {
  await install(page, "viewer");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-dify-add")).toHaveCount(0);
});

test("owner: bước đầu không có nút xoá/điều kiện; thiếu tên khoá nút Lưu", async ({ page }) => {
  await install(page, "owner");
  const dlg = await open(page);
  await expect(
    dlg.getByTestId("flow-step-0").getByRole("button", { name: "Xoá bước" }),
  ).toHaveCount(0);
  await expect(dlg.getByTestId("flow-step-0").getByText("không có điều kiện")).toBeVisible();
  await dlg.getByRole("button", { name: "Thêm bước duyệt" }).click();
  await expect(dlg.getByText("Nhập tên bước.")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Lưu quy trình" })).toBeDisabled();
});

test("lỗi server hiện theo trường của bước", async ({ page }) => {
  await install(page, "owner", 422);
  const dlg = await open(page);
  await dlg.getByTestId("flow-step-1").getByLabel("Hạn xử lý (giờ)").fill("48");
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect(
    dlg.getByTestId("flow-step-1").getByText("Hạn xử lý phải là số giờ nguyên từ 4 đến 2160."),
  ).toBeVisible();
});

test("viewer: xem được nhưng không sửa", async ({ page }) => {
  await install(page, "viewer");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-step-1")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Lưu quy trình" })).toHaveCount(0);
  await expect(dlg.getByRole("button", { name: "Thêm bước duyệt" })).toHaveCount(0);
  await expect(dlg.getByTestId("flow-step-1").getByLabel("Tên bước")).toBeDisabled();
});

test("409 VERSION_CONFLICT: báo luồng đã bị sửa + nút Tải lại", async ({ page }) => {
  await install(page, "owner", 409);
  const dlg = await open(page);
  await dlg.getByTestId("flow-step-1").getByLabel("Hạn xử lý (giờ)").fill("48");
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect(dlg.getByText("Luồng đã được người khác sửa, tải lại.")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Tải lại" })).toBeVisible();
});

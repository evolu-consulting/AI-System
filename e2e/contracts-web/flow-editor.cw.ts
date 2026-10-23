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
  due_h: 24,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when,
});
const FLOW = {
  version: 3,
  is_default: true,
  steps: [
    review("s0", "Soạn & kiểm tra", D1),
    review("s1", "Kế toán", D2, { op: "and", value: { cmp: "gte", amount: 100000000 } }),
  ],
};

async function install(page: Page, role: Role, putStatus = 200) {
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
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/admin/org", (r) =>
    json(r, 200, {
      members: [],
      departments: [
        { group_id: D1, key: "kd", name: "Kinh doanh", head_user_id: null, member_ids: [] },
        { group_id: D2, key: "kt", name: "Kế toán", head_user_id: null, member_ids: [] },
      ],
    }),
  );
  await page.route("**/pack/contracts/approval-flow", (r) => {
    if (r.request().method() === "PUT") {
      const body = r.request().postDataJSON();
      puts.push(body);
      if (putStatus !== 200)
        return json(r, 400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "bad",
            details: { issues: [{ path: ["steps", 1, "due_h"], message: "Hạn quá dài" }] },
          },
        });
      return json(r, 200, { version: 4, is_default: false, steps: body.steps });
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
  await expect(dlg.getByText("Dùng mặc định")).toBeVisible();
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
  expect((puts[0] as { steps: unknown[] }).steps).toHaveLength(3);
  await expect(dlg.getByText("Dùng mặc định")).toHaveCount(0);
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
  await install(page, "owner", 400);
  const dlg = await open(page);
  await dlg.getByTestId("flow-step-1").getByLabel("Hạn xử lý (giờ)").fill("48");
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect(dlg.getByTestId("flow-step-1").getByText("Hạn quá dài")).toBeVisible();
});

test("viewer: xem được nhưng không sửa", async ({ page }) => {
  await install(page, "viewer");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-step-1")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Lưu quy trình" })).toHaveCount(0);
  await expect(dlg.getByRole("button", { name: "Thêm bước duyệt" })).toHaveCount(0);
  await expect(dlg.getByTestId("flow-step-1").getByLabel("Tên bước")).toBeDisabled();
});

// CR-108: thêm hạn/nhắc/số người duyệt mỗi bước, nhánh bỏ qua + nhãn điều kiện trên canvas, ô giá trị có ngăn nghìn + nút nhanh,
// giải thích mặc định/chỉ đọc, chú giải, ẩn thanh Lưu ở mục này; ảnh chụp 1440x900 vào .data/cr108.
// CR-105 L4 · Cài đặt › Quy trình duyệt chỉ ĐỌC: "đang dùng: <tên> · v<N>", sơ đồ bước, xem trước đường đi, không có form sửa/Lưu;
// lối vào ai-admin chỉ hiện cho platform_admin. Backend giả `page.route` (hình GET mới của design.md §4). VIẾT, CHƯA CHẠY (e2e chạy cuối đợt).
import { mkdirSync } from "node:fs";
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
  owner_can_override: true,
  owner_group_name: "Ban lãnh đạo",
  steps: [
    {
      name: "Soạn & kiểm tra",
      department_name: "Kinh doanh",
      kind: "review",
      when: null,
      due_h: 72,
      approver_count: 3,
    },
    {
      name: "Giám đốc duyệt",
      department_name: "Ban giám đốc",
      kind: "review",
      when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 500_000_000 }] },
      due_h: 24,
      remind_every_h: 8,
      escalate_group_name: "Kế toán",
      escalate_default: true,
      approver_count: 2,
    },
  ],
};

async function install(page: Page, role: "tenant_admin" | "platform_admin") {
  await page.setViewportSize({ width: 1440, height: 900 }); // ảnh minh hoạ CR-108 chụp ở 1440x900
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

// Ảnh minh hoạ CR-108 (đường tuyệt đối theo yêu cầu của người giao việc).
const SHOTS = "F:/workspace/evolu-platform/.data/cr108";

test("Cài đặt hiện quy trình đang dùng, không có form sửa", async ({ page }) => {
  const writes = await install(page, "tenant_admin");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-current-title")).toHaveText(
    "Quy trình duyệt đang dùng: Quy trình HĐ mặc định · v4",
  );
  // CR-106: mặc định là canvas chỉ đọc (Bắt đầu + 2 bước + Ghi Đã duyệt); công tắc "Danh sách" hiện `flow-diagram`
  await expect(dlg.getByTestId("flow-canvas")).toBeVisible();
  await expect(dlg.getByTestId("flow-canvas").getByText("Giám đốc duyệt")).toBeVisible();
  await expect(dlg.getByTestId("flow-canvas").getByText("Ghi Đã duyệt")).toBeVisible();
  // CR-108: thông tin mỗi bước trên node + nhãn điều kiện / nhánh bỏ qua trên cạnh + chú giải
  const cv = dlg.getByTestId("flow-canvas");
  await expect(cv.getByText("Hạn 72 giờ", { exact: true })).toBeVisible();
  await expect(cv.getByText("Hạn 24 giờ · nhắc mỗi 8 giờ")).toBeVisible();
  await expect(cv.getByText("3 người duyệt")).toBeVisible();
  await expect(cv.getByText("2 người duyệt")).toBeVisible();
  await expect(cv.getByText("Quá hạn ⇒ chuyển Kế toán (mặc định)")).toBeVisible();
  // CR-113: hộp "Luật duyệt" dưới sơ đồ + chú giải chuyển cấp
  const rules = dlg.getByTestId("flow-rules");
  await expect(rules.getByTestId("flow-rule-owner")).toHaveText(
    "Toàn quyền (Ban lãnh đạo) duyệt thay được mọi bước — lượt duyệt thay được ghi rõ.",
  );
  await expect(rules.getByTestId("flow-rule-escalate")).toHaveText(
    "Bước có hạn: quá hạn tự chuyển cho Kế toán (mặc định Toàn quyền).",
  );
  await expect(dlg.getByTestId("flow-legend")).toContainText("Quá hạn ⇒ chuyển cấp");
  await expect(cv.getByText("Giá trị ≥ 500.000.000")).toBeVisible();
  await expect(cv.getByText("Không thoả ⇒ bỏ qua")).toBeVisible();
  await expect(dlg.getByTestId("flow-legend")).toContainText("Bước hệ thống (khoá)");
  await expect(dlg.getByTestId("flow-legend")).toContainText("Nhánh bỏ qua");
  await expect(dlg.getByTestId("flow-legend")).toContainText("Mờ = bị bỏ qua theo xem trước");
  // CR-108: giải thích mặc định + chỉ xem; thanh Lưu ẩn ở mục này
  await expect(dlg.getByTestId("flow-default-badge")).toHaveText("Đang dùng mặc định");
  await expect(dlg.getByTestId("flow-default-help")).toHaveText(
    "Công ty bạn chưa được gán quy trình riêng, đang dùng quy trình mặc định của hệ thống.",
  );
  await expect(dlg.getByTestId("flow-readonly-lead")).toHaveText(
    "Mục này chỉ để xem. Muốn đổi quy trình, liên hệ quản trị nền tảng.",
  );
  await expect(page.getByRole("button", { name: "Lưu cài đặt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Khôi phục tất cả" })).toHaveCount(0);
  await expect(page.getByTestId("settings-nosave-note")).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await cv.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/canvas.png` });
  await expect(dlg.getByTestId("flow-diagram")).toHaveCount(0);
  await dlg.getByTestId("flow-view-list").click();
  await expect(dlg.getByTestId("flow-canvas")).toHaveCount(0);
  await expect(dlg.getByTestId("flow-diagram").getByRole("listitem")).toHaveCount(2);
  await expect(dlg.getByTestId("flow-diagram").getByTestId("step-due")).toHaveCount(2);
  await dlg.getByTestId("flow-view-canvas").click();
  await expect(dlg.getByTestId("flow-canvas")).toBeVisible();
  // không form sửa: không nút thêm bước/lưu, không ô nhập tên bước
  await expect(dlg.getByRole("button", { name: /Thêm bước|Lưu quy trình/ })).toHaveCount(0);
  await expect(dlg.getByLabel("Tên bước")).toHaveCount(0);
  // người không phải platform_admin không thấy lối vào ai-admin
  await expect(dlg.getByTestId("flow-editor-link")).toHaveCount(0);
  // xem trước: giá trị 50 ⇒ bước 2 bị bỏ qua; chip "500 triệu" ⇒ ô hiện 500.000.000 và bước 2 chạy
  const val = dlg.getByLabel("Giá trị mẫu");
  await val.fill("50");
  await expect(dlg.getByTestId("flow-preview").getByRole("listitem").nth(1)).toHaveAttribute(
    "data-run",
    "false",
  );
  await expect(dlg.getByTestId("flow-preview-summary")).toHaveText(
    "Hợp đồng này đi qua 1/2 bước: Soạn & kiểm tra",
  );
  // canvas làm mờ bước bị bỏ qua (CR-106)
  await expect(dlg.getByTestId("flow-canvas").locator('[data-run="false"]')).toHaveCount(1);
  await val.fill("1500000");
  await expect(val).toHaveValue("1.500.000");
  await dlg.getByTestId("flow-quick-m500").click();
  await expect(val).toHaveValue("500.000.000");
  await expect(dlg.getByTestId("flow-preview").getByRole("listitem").nth(1)).toHaveAttribute(
    "data-run",
    "true",
  );
  await expect(dlg.getByTestId("flow-preview-summary")).toHaveText(
    "Hợp đồng này đi qua 2/2 bước: Soạn & kiểm tra → Giám đốc duyệt",
  );
  await dlg.getByTestId("flow-quick-m100").click();
  await expect(val).toHaveValue("100.000.000");
  await expect(dlg.getByTestId("flow-preview-summary")).toContainText("1/2");
  await dlg.getByTestId("flow-quick-empty").click();
  await expect(val).toHaveValue("");
  await dlg.getByTestId("flow-quick-m500").click();
  await dlg.getByTestId("flow-preview-summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/preview-500tr.png` });
  // sang mục có ô sửa được ⇒ thanh Lưu hiện lại
  await dlg.getByRole("button", { name: /^Công ty/ }).click();
  await expect(page.getByRole("button", { name: "Lưu cài đặt" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("platform_admin thấy lối vào ai-admin ở Cài đặt", async ({ page }) => {
  await install(page, "platform_admin");
  const dlg = await open(page);
  await expect(dlg.getByTestId("flow-editor-link")).toHaveText("Chỉnh quy trình duyệt");
});

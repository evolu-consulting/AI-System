// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// pm-checklist-e2e · CR-113 · checklist Sổ Hợp Tác (docs/PM-SETUP.md §5 bước 1–5) trên UI thật + 3 HĐ mẫu `[CR-113]` do seed tạo.
// Mỗi người dùng đăng nhập ở context mới bằng trang đăng nhập của app (thay cho "đăng xuất, đăng nhập lại").
// Quá hạn: seed đã đẩy escalate_at về quá khứ; thay vì chờ vòng 300 s, spec gọi MỘT lượt nhắc qua cổng điều khiển của stack (như test CF `remindOnce`).
import { expect, type Page, test } from "@playwright/test";

const DEMO_PW = "1234567890"; // fixture dev (tools/hub-dev/src/fixture.ts), không phải secret
const T = {
  pending: "[CR-113] HĐ chờ duyệt bước 1",
  override: "[CR-113] HĐ do Toàn quyền duyệt thay bước 1",
  overdue: "[CR-113] HĐ quá hạn bước 1",
};
const ID = (n: number) => `c1130000-0000-4000-8000-00000000000${n}`;

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await page.getByRole("textbox", { name: "Email" }).fill(username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(DEMO_PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function openContract(page: Page, n: number, title: string) {
  await page.goto(`/contracts/c/${ID(n)}`);
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("approval-step-0")).toBeVisible();
}
/** Thẻ flow theo sự kiện (CR-125): bước 1 là bước Duyệt thật ⇒ người duyệt bấm "Duyệt" (không còn bước soạn "Gửi duyệt"). */
async function passStep1(page: Page) {
  await page.getByRole("button", { name: "Duyệt", exact: true }).click();
}
/** HĐ mẫu do edgar.nguyen tạo (không thuộc Trưởng phòng): bước Duyệt loại người tạo (`exclude_starter`) nên thomas.tran duyệt được. */ const step =
  (p: Page, i: number) => p.getByTestId(`approval-step-${i}`);

test("CR-113 · 1 · Cài đặt › Quy trình duyệt: 2 bước, hộp Luật duyệt, bước 1 'Quá hạn ⇒ chuyển … (mặc định)'", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt Sổ Hợp Tác", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  await expect(dlg.getByTestId("flow-current-title")).toContainText("Duyệt 2 cấp"); // CR-125 · S2: Cài đặt hiện flow Bật của company_flows (cùng tab Quy trình)
  const cv = dlg.getByTestId("flow-canvas");
  await expect(cv.getByText("Trưởng phòng duyệt")).toBeVisible();
  await expect(cv.getByText("Giám đốc duyệt")).toBeVisible();
});

test("CR-113 · 2 · HĐ chờ bước 1: bước 1 đang mở, julian.bui (Toàn quyền, ngoài nhóm Trưởng phòng) có nút Duyệt / Trả lại sửa / Từ chối", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 1, T.pending);
  await expect(step(page, 0)).toHaveAttribute("data-status", "open");
  // Thẻ flow theo sự kiện: bước 1 là bước Duyệt thật ⇒ chủ gói (Toàn quyền, ngoài nhóm Trưởng phòng) thấy Duyệt / Trả lại sửa / Từ chối, không có "Gửi duyệt" của bước soạn.
  await expect(page.getByRole("button", { name: "Duyệt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trả lại sửa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Từ chối" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gửi duyệt" })).toHaveCount(0);
});

test("CR-113 · 3 · HĐ Toàn quyền duyệt thay: bước 1 có huy hiệu 'Duyệt thay · Toàn quyền', bước 2 (Giám đốc) mở", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 2, T.override);
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveText(
    "Duyệt thay · Toàn quyền",
  );
  await expect(step(page, 1)).toHaveAttribute("data-status", "open");
});

// cr125-fix-escalate-kick: mẫu "Duyệt 2 cấp" có hạn 72 h + chuyển cấp về Toàn quyền (`contracts-owner`) như khe cũ.
test("CR-113 · 5 · HĐ quá hạn: 'Quá hạn'; sau một lượt nhắc 'Đã chuyển cho …'; julian.bui quyết không còn là duyệt thay", async ({
  page,
  request,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 3, T.overdue);
  await expect(step(page, 0).getByTestId("approval-overdue")).toHaveText("Quá hạn");
  await expect(step(page, 0).getByTestId("approval-escalated-to")).toHaveCount(0);
  const r = await request.post(`${process.env.PM_CTL_URL}/ctl/remind`);
  expect(r.ok()).toBe(true);
  await page.reload();
  await expect(step(page, 0).getByTestId("approval-escalated-to")).toContainText("Đã chuyển cho");
  await passStep1(page);
  await expect(step(page, 0)).toHaveAttribute("data-status", "passed");
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveCount(0);
});

test("CR-113 · 4 · thomas.tran (Trưởng phòng) Duyệt bước 1 HĐ chờ: bước 1 đã duyệt KHÔNG có huy hiệu duyệt thay, bước 2 (Giám đốc) mở", async ({
  page,
}) => {
  await login(page, "thomas.tran");
  await openContract(page, 1, T.pending);
  await passStep1(page);
  await expect(step(page, 0)).toHaveAttribute("data-status", "passed");
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveCount(0);
  // engine mở bước 2 bất đồng bộ: tải lại tới khi bước 2 mở
  await expect
    .poll(
      async () => {
        await page.reload();
        return step(page, 1).getAttribute("data-status");
      },
      { timeout: 30_000 },
    )
    .toBe("open");
});

test("cr120-handson-fixes · 1b · đăng nhập từ trang quay về của SSO (`/contracts/login?sso=none&next=/contracts`) ⇒ về /contracts, không phải /contracts/c/login", async ({
  page,
}) => {
  await page.goto("/contracts/login?sso=none&next=%2Fcontracts");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await page.getByRole("textbox", { name: "Email" }).fill("julian.bui");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(DEMO_PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/contracts\/?(\?.*)?$/);
  await expect(page).not.toHaveURL(/\/contracts\/c\//);
  await expect(page.getByRole("heading", { name: "Tổng quan" }).first()).toBeVisible();
  await expect(page.getByText("Invalid request")).toHaveCount(0);
});

test("cr120-handson-fixes · 1c · mã hợp đồng sai ⇒ câu 'Không tìm thấy hợp đồng' đã dịch, không phải 'Invalid request'", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await page.goto("/contracts/c/login");
  await expect(page.getByText("Không tìm thấy hợp đồng")).toBeVisible();
  await expect(page.getByText("Invalid request")).toHaveCount(0);
});

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
  await page.goto(`/contracts/${ID(n)}`);
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("approval-step-0")).toBeVisible();
}
const step = (p: Page, i: number) => p.getByTestId(`approval-step-${i}`);

test("CR-113 · 1 · Cài đặt › Quy trình duyệt: 2 bước, hộp Luật duyệt, bước 1 'Quá hạn ⇒ chuyển … (mặc định)'", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  await expect(dlg.getByTestId("flow-current-title")).toContainText("Duyệt HĐ 2 cấp");
  const rules = dlg.getByTestId("flow-rules");
  await expect(rules).toContainText("Luật duyệt");
  await expect(rules.getByTestId("flow-rule-owner")).toContainText("duyệt thay được mọi bước");
  await expect(rules.getByTestId("flow-rule-escalate")).toContainText("quá hạn tự chuyển cho");
  const cv = dlg.getByTestId("flow-canvas");
  await expect(cv.getByText(/Quá hạn ⇒ chuyển .*\(mặc định\)/)).toHaveCount(1);
  await expect(cv.getByText(/Quá hạn ⇒ chuyển /)).toHaveCount(2);
  await expect(cv.getByText("Kế toán duyệt")).toBeVisible();
  await expect(cv.getByText("Pháp chế duyệt")).toBeVisible();
});

test("CR-113 · 2 · HĐ chờ bước 1: bước 1 đang mở, julian.bui (Toàn quyền, ngoài Kế toán) có nút Đạt / Trả lại", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 1, T.pending);
  await expect(step(page, 0)).toHaveAttribute("data-status", "open");
  await expect(page.locator('[data-approval="pass"]')).toBeVisible();
  await expect(page.locator('[data-approval="return"]')).toBeVisible();
});

test("CR-113 · 3 · HĐ Toàn quyền duyệt thay: bước 1 có huy hiệu 'Duyệt thay · Toàn quyền', bước 2 chờ Pháp chế", async ({
  page,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 2, T.override);
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveText(
    "Duyệt thay · Toàn quyền",
  );
  await expect(step(page, 1)).toHaveAttribute("data-status", "open");
});

test("CR-113 · 5 · HĐ quá hạn: 'Quá hạn'; sau một lượt nhắc 'Đã chuyển cho …'; julian.bui quyết không còn là duyệt thay", async ({
  page,
  request,
}) => {
  await login(page, "julian.bui");
  await openContract(page, 3, T.overdue);
  await expect(step(page, 0).getByTestId("approval-overdue")).toHaveText("Quá hạn");
  await expect(step(page, 0).getByTestId("approval-escalated-to")).toHaveCount(0);
  const r = await request.post(`${process.env.PM_CTL_URL}/ctl/remind`);
  expect((await r.json()).reminded).toBeGreaterThan(0);
  await page.reload();
  await expect(step(page, 0).getByTestId("approval-escalated-to")).toContainText("Đã chuyển cho");
  await page.locator('[data-approval="pass"]').click();
  await expect(step(page, 0)).toHaveAttribute("data-status", "passed");
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveCount(0);
});

test("CR-113 · 4 · thomas.tran (Kế toán) Đạt bước 1 HĐ chờ: bước 1 đã duyệt KHÔNG có huy hiệu duyệt thay, bước 2 mở cho Pháp chế", async ({
  page,
}) => {
  await login(page, "thomas.tran");
  await openContract(page, 1, T.pending);
  await page.locator('[data-approval="pass"]').click();
  await expect(step(page, 0)).toHaveAttribute("data-status", "passed");
  await expect(step(page, 0).getByTestId("approval-owner-override")).toHaveCount(0);
  await expect(step(page, 1)).toHaveAttribute("data-status", "open");
});

// CR-181 · s4 · hành trình đăng nhập lần đầu: công ty bật ký trên tài liệu ⇒ màn «Tạo chữ ký của bạn» chắn trước app ⇒ gõ họ tên, «Lưu và vào Evolu»
// ⇒ vào app ⇒ menu tài khoản «Chữ ký của tôi» thấy chữ ký (kiểm cả điện thoại 390px: một cột, nút ≥ 44px). Công ty `e2e-s2-<hậu tố>` (dựng bởi `_cr127-stack.ts`);
// quản trị bật cấu hình bằng `PUT /company/signature-settings`; người dùng thành viên là người đăng nhập lần đầu (khác người cấu hình).
// Viết theo khuôn e2e/cr127/*; chưa chạy (điều phối chạy cuối đợt).

import { API, apiAs, envOf, expect, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j03);

test.beforeAll(async () => {
  // Người quản trị công ty bật ký trên tài liệu, bắt buộc tạo chữ ký, chỉ cho «Gõ họ tên» để test không cần vẽ.
  const admin = await apiAs(E, U.director, "contracts"); // giám đốc = quản trị công ty (giả định của lát s4; s5 sẽ có hành trình quản trị riêng)
  const res = await fetch(`${API}/company/signature-settings`, {
    method: "PUT",
    headers: { ...admin.headers, "content-type": "application/json" },
    body: JSON.stringify({
      methods: ["type"],
      required: true,
      caption: ["name", "date"],
      ink: "blue",
      initials: "shrink",
      change_policy: "self",
      on_doc_enabled: true,
      digital_enabled: false,
      digital_provider: null,
    }),
  });
  expect(res.ok).toBeTruthy();
});

test("Lần đầu đăng nhập ⇒ tạo chữ ký ⇒ vào app ⇒ «Chữ ký của tôi»", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  const gate = page.getByRole("dialog", { name: "Tạo chữ ký của bạn" });
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("button", { name: "Làm sau" })).toHaveCount(0); // bắt buộc
  await gate.getByRole("textbox", { name: "Họ tên" }).fill("Nguyễn Văn Hùng");
  await gate.getByRole("button", { name: "Lưu và vào Evolu" }).click();
  await expect(gate).toBeHidden();

  await page
    .getByRole("button", { name: /Tài khoản/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Chữ ký của tôi" }).click();
  await expect(page.getByRole("heading", { name: "Chữ ký của tôi" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Chữ ký đang dùng" })).toBeVisible();
  await expect(page.getByText("Chưa được gán")).toBeVisible();
  await expect(page.getByText(/tạo bằng gõ tên/)).toBeVisible();
});

test("Điện thoại 390px: một cột, nút Tạo chữ ký mới ≥ 44px", async ({ browser }) => {
  const page = await newPage(browser, 390);
  await loginCw(page, E, U.employee);
  await page.goto("/my-signature");
  const btn = page.getByRole("button", { name: "Tạo chữ ký mới" });
  await expect(btn).toBeVisible();
  expect((await btn.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const a = await page.getByRole("heading", { name: "Chữ ký nội bộ đang dùng" }).boundingBox();
  const b = await page.getByRole("heading", { name: "Chữ ký số" }).boundingBox();
  expect(b?.y ?? 0).toBeGreaterThan((a?.y ?? 0) + 40); // thẻ xếp dọc, không cạnh nhau
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

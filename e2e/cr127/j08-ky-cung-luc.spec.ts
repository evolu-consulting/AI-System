// CR-127 · J08 · U6 · ký cùng lúc giữa hai công ty (stack journey thật, cặp `e2e-d5a` → `e2e-d5b`; flow gửi của A có «ký cùng lúc», B có nhóm «Người ký HĐ» đã đặt ở Cài đặt):
// bên nhận trả lời Đồng ý (chọn người ký trong nhóm) ⇒ phiên ký chung hai dòng ký ở CẢ HAI bên; Huỷ phiên ký (cần lý do); Xử lý bình thường. Nhà cung cấp selfsign ⇒ chưa có giá trị pháp lý.
// Tiền đề: hai HĐ gửi từ A (tải → duyệt → chọn đối tác) và B đã nhận lời mời nối (băng ở đầu danh sách).
import { test } from "../journey-approval/_test";
import {
  acceptInvite,
  contractRows,
  envOf,
  expect,
  loginCw,
  newPage,
  SPEC_TENANT,
  sendFromA,
  U,
} from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const [KA, KB] = SPEC_TENANT.j08;
const [EA, EB] = [envOf(KA), envOf(KB)];
const RUN = Date.now().toString(36);
const ROW = (run: string) => `E2E-JOURNEY-${run}`;
const rowOf = (page: import("@playwright/test").Page, run: string) =>
  contractRows(page)
    .filter({ hasText: ROW(run) })
    .first();
test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  // lần gửi đầu bị giữ tới khi B nhận lời mời nối (không có phiên ký chung); ba lần sau gửi qua nền tảng, tệp PDF ⇒ mỗi HĐ một phiên đề nghị
  await sendFromA(browser, EA, KB, `${RUN}a`);
  await acceptInvite(browser, EB);
  for (const r of ["b", "c", "d"]) await sendFromA(browser, EA, KB, `${RUN}${r}`, true);
});

test("Bên nhận Đồng ý ⇒ hai dòng ký; bên gửi thấy giống nhau, không lộ người duyệt nội bộ", async ({
  browser,
}) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}b`).click();
  const card = b.getByTestId("sign-session");
  await expect(card).toHaveAttribute("data-phase", "proposed");
  await expect(card.getByRole("button", { name: /Đồng ý ký cùng lúc/ })).toBeDisabled();
  await card.getByLabel(/Người ký phía công ty/).selectOption({ index: 1 });
  await card.getByRole("button", { name: /Đồng ý ký cùng lúc/ }).click();
  await expect(b.getByTestId("sign-session")).toHaveAttribute("data-phase", /accepted|signing/);
  await expect(b.getByTestId("cosign-row")).toHaveCount(2);
  await expect(b.getByTestId("sign-session")).toContainText("chưa có giá trị pháp lý");

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await a.goto("/contracts/list");
  await rowOf(a, `${RUN}b`).click();
  await expect(a.getByTestId("cosign-row")).toHaveCount(2);
});

test("Huỷ phiên ký cần lý do", async ({ page }) => {
  await loginCw(page, EA, U.employee);
  await page.goto("/contracts/list");
  await rowOf(page, `${RUN}c`).click();
  const cancel = page.getByTestId("cosign-cancel");
  await expect(cancel.getByRole("button", { name: /Huỷ phiên ký/ })).toBeDisabled();
  await cancel.getByPlaceholder(/Lý do/).fill("Cần sửa điều 4");
  await cancel.getByRole("button", { name: /Huỷ phiên ký/ }).click();
  await expect(page.getByTestId("sign-session")).toHaveAttribute("data-phase", "cancelled");
});

test("Bên nhận chọn Xử lý bình thường ⇒ quay về quy trình nhận", async ({ page }) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts/list?source=partner");
  await rowOf(page, `${RUN}d`).click();
  await page
    .getByTestId("cosign-respond")
    .getByRole("button", { name: /Xử lý bình thường/ })
    .click();
  await expect(page.getByTestId("sign-session")).toHaveAttribute("data-phase", "fallback");
});

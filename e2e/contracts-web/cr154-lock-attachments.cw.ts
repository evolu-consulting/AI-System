// CR-154 · «Tài liệu kèm»: HĐ không còn Nháp ⇒ ẩn nút «Thêm tệp», không câu giải thích khoá; HĐ nháp có quyền ⇒ còn nút (backend giả `page.route`).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";
import { mockContractFiles } from "./flow-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

async function open(page: Page, status: string, files: { can_add: boolean; locked: boolean }) {
  const d = asHub("editor");
  await page.addInitScript(() => {
    localStorage.setItem("ai.locale", "vi");
    localStorage.setItem("assistant:open", "0");
  });
  const j = (r: Parameters<Parameters<Page["route"]>[1]>[0], b: unknown) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route("**/auth/refresh", (r) => j(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => j(r, d.packMe));
  await page.route("**/pack/contracts/contracts/**", (r) => j(r, contractAsHub(status as never)));
  await mockContractFiles(page, files);
  await page.goto(`/contracts/c/${contract.id}`);
}

test("HĐ đang duyệt: ẩn nút Thêm tệp và chỉ một trạng thái trống", async ({ page }) => {
  await open(page, "processing", { can_add: false, locked: true });
  await expect(page.getByTestId("cfiles-empty")).toBeVisible(); // một trạng thái trống duy nhất, không câu giải thích khoá
  await expect(page.getByTestId("cfiles-add")).toHaveCount(0);
});

test("HĐ nháp có quyền: còn nút Thêm tệp, không có lý do khoá", async ({ page }) => {
  await open(page, "draft", { can_add: true, locked: false });
  await expect(page.getByTestId("cfiles-add")).toBeVisible();
  await expect(page.getByTestId("cfiles-empty")).toBeVisible();
});

test("HĐ không có mốc và không có lưu ý: khối Thông tin chiếm full chiều ngang (desktop)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "processing", { can_add: false, locked: true });
  const left = page.getByTestId("detail-left");
  await expect(left).toBeVisible();
  await expect(page.getByTestId("detail-right")).toBeHidden();
  const box = await left.boundingBox();
  const parent = await left.locator("xpath=..").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan((parent?.width ?? 1) - 2);
});

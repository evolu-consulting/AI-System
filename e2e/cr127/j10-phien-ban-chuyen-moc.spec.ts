// CR-127 · J10 · U5 · phiên bản mới (stack journey thật, công ty `e2e-par-<hậu tố>` có quy trình «Giám đốc duyệt» từ sơ đồ trống): HĐ DONE có mốc ⇒ "Tải phiên bản mới" ⇒ bản v2 ở DRAFT (v1 vẫn dùng được);
// v2 Gửi duyệt + Giám đốc duyệt xong ⇒ mốc mở chuyển sang v2, v1 hiện "Đã thay thế".

import { buyContract } from "../journey-approval/_fixture";
import { confirmAndSave } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";
import {
  approveAs,
  doneContractWithMilestones,
  envOf,
  expect,
  loginCw,
  newPage,
  SPEC_TENANT,
  U,
} from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j10);
let contract = "";
let v2Url = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  contract = await doneContractWithMilestones(browser, E, `j10-${Date.now().toString(36)}`);
});

test("Tải phiên bản mới ⇒ v2 DRAFT; trang v1 vẫn là DONE với mốc đang mở", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${contract}`);
  await expect(page.getByTestId("status-chip")).toHaveAttribute("data-status", "done");
  await page.getByTestId("act-newVersion").click();
  await page.getByTestId("upload-version-file").setInputFiles({
    name: "hop-dong-v2.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(buyContract(`v2-${Date.now().toString(36)}`).text, "utf8"),
  });
  await page.getByTestId("upload-version-submit").click();
  // mở bản mới ở DRAFT (chỉ DRAFT là form)
  await expect(page.getByTestId("status-chip")).toHaveAttribute("data-status", "draft");
  v2Url = page.url();
});

test("v2 DONE ⇒ mốc mở sang v2 (giữ nguyên), v1 chỉ đọc và dẫn tới bản hiện hành", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await loginCw(page, E, U.employee);
  await page.goto(v2Url || `/contracts/c/${contract}`);
  // gửi v2 đi duyệt (công ty có quy trình «Giám đốc duyệt») ⇒ Giám đốc duyệt ⇒ DONE, rồi quay lại
  const v2Id = /\/contracts\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  expect(v2Id).not.toBe("");
  await confirmAndSave(page);
  await approveAs(await newPage(browser), E, U.director, v2Id, "Giám đốc duyệt");
  await page.reload();
  await expect(page.getByTestId("status-chip")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("ms-row")).not.toHaveCount(0);
  await page.getByTestId("version-row-1").getByRole("button", { name: "Xem" }).click();
  await expect(page.getByTestId("superseded-banner")).toBeVisible();
  await expect(page.getByTestId("act-newVersion")).toHaveCount(0);
});

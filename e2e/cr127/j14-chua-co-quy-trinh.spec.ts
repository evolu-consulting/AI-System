// CR-127 · J14 · NF1 · công ty CHƯA có quy trình duyệt (stack journey thật, `e2e-s7b-<hậu tố>`: cờ chạy theo sự kiện bật, không ai tạo/gán quy trình): nhân viên tải HĐ ⇒ nút Gửi
// khoá + câu lý do + bước kế (nhờ quản trị soạn ở mục Quy trình); «Lưu nháp» vẫn lưu được và không mất phần đã sửa; gọi API gửi thẳng ⇒ 409 `NO_APPROVAL_FLOW`.
import { buyContract } from "../journey-approval/_fixture";
import { test } from "../journey-approval/_test";
import { apiAs, envOf, expect, HUB, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j14);
const NAME = `HĐ chưa có quy trình ${Date.now().toString(36)}`;
let id = "";

test("Chưa có quy trình ⇒ nút Gửi khoá, nói lý do và việc cần làm; Lưu nháp giữ nguyên chỗ đã sửa", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/list`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "hop-dong-j14.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(buyContract("j14", 120_000_000).text, "utf8"),
  });
  await page.getByTestId("upload-confirm").click();
  await page.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/, { timeout: 60_000 });
  id = /\/contracts\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const title = page.getByRole("textbox", { name: /^Tên hợp đồng/ });
  await expect(title).not.toHaveValue("", { timeout: 120_000 });

  // khoá + lý do (câu nói cách khắc phục)
  const why = page.getByTestId("submit-blocked");
  await expect(why).toBeVisible({ timeout: 60_000 });
  await expect(why).toContainText("Công ty chưa có quy trình duyệt hợp đồng");
  await expect(why).toContainText("Quy trình");
  const send = page.getByRole("button", { name: "Gửi duyệt" });
  await expect(async () => {
    expect((await send.count()) === 0 || (await send.first().isDisabled())).toBe(true);
  }).toPass({ timeout: 10_000 });
  await expect(page.getByTestId("confirm-save")).toHaveCount(0);

  // Lưu nháp: sửa tên, lưu, tải lại ⇒ còn nguyên
  await title.fill(NAME);
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: /^Tên hợp đồng/ })).toHaveValue(NAME, {
    timeout: 60_000,
  });
  await expect(page.getByTestId("status-chip")).toHaveAttribute("data-status", "draft");
});

test("Gọi gửi duyệt thẳng bằng API khi chưa có quy trình ⇒ 409 NO_APPROVAL_FLOW, HĐ vẫn là nháp", async () => {
  const s = await apiAs(E, U.employee);
  const r = await fetch(`${HUB}/pack/contracts/contracts/${id}/submit`, {
    method: "POST",
    headers: { ...s.headers, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(r.status).toBe(409);
  expect(((await r.json()) as { error?: { code?: string } }).error?.code).toBe("NO_APPROVAL_FLOW");
  const d = await fetch(`${HUB}/pack/contracts/contracts/${id}`, { headers: s.headers });
  expect(((await d.json()) as { status?: string }).status).toBe("draft");
});

// CR-101a · R12 · R14 · X5 (Câu 6, 10): editor là NGƯỜI PHỤ TRÁCH HĐ đã khoá thấy «Mở lại» ⇒ lý do bắt buộc ⇒ POST /reopen; server từ
// chối (403 REOPEN_FORBIDDEN) ⇒ câu lỗi trong hộp thoại; phiên bản v2 có số điền sẵn "số gốc-SĐ1" (chưa xác minh) sửa được.
// Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { dataset } from "./dataset";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const ME = dataset.user.id;
const locked = (over: object = {}) =>
  activeContract({
    locked: true,
    locked_at: "2026-10-17T02:00:00.000Z",
    locked_by: ME,
    owner_user_id: ME,
    ...over,
  });

test("editor phụ trách: «Mở lại» ⇒ lý do bắt buộc ⇒ POST /reopen {reason} ⇒ Chờ duyệt", async ({
  page,
}) => {
  let reopened = false;
  const sent = await installV2f(page, {
    role: "editor",
    contract: () => (reopened ? activeContract({ status: "needs_review" }) : locked()),
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("reopen-link").click();
  const dlg = page.getByRole("dialog", { name: "Mở lại hợp đồng" });
  await expect(dlg.getByTestId("reopen-confirm")).toBeDisabled();
  await dlg.getByLabel(/^Lý do mở lại/).fill("AI đọc sai số hợp đồng");
  reopened = true;
  await dlg.getByTestId("reopen-confirm").click();
  await expect(page.getByTestId("banner-pending")).toContainText("Chưa xác nhận");
  expect(sent.find((s) => s.path.endsWith("/reopen"))).toEqual({
    method: "POST",
    path: `/pack/contracts/contracts/${ACTIVE_ID}/reopen`,
    body: { reason: "AI đọc sai số hợp đồng" },
  });
});

test("server từ chối mở lại (403 REOPEN_FORBIDDEN) ⇒ câu lỗi, HĐ vẫn khoá", async ({ page }) => {
  await installV2f(page, { role: "editor", contract: () => locked() });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/reopen`, (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "REOPEN_FORBIDDEN", message: "Forbidden" } }),
    }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("reopen-link").click();
  const dlg = page.getByRole("dialog", { name: "Mở lại hợp đồng" });
  await dlg.getByLabel(/^Lý do mở lại/).fill("thử");
  await dlg.getByTestId("reopen-confirm").click();
  await expect(dlg.getByRole("alert")).toHaveText(
    "Chỉ người phụ trách hợp đồng hoặc chủ sở hữu mới được mở lại.",
  );
  await expect(page.getByTestId("banner-locked")).toBeVisible();
});

test("phiên bản v2 Chờ duyệt: số điền sẵn «số gốc-SĐ1» hiện ở ô Số hợp đồng và sửa được", async ({
  page,
}) => {
  const base = activeContract({ status: "needs_review" }) as { fields: Record<string, unknown> };
  await installV2f(page, {
    role: "editor",
    contract: () => ({
      ...base,
      version_no: 2,
      fields: {
        ...base.fields,
        number: { value: "HĐ-7-SĐ1", quote: "", verified: false, edited: false },
      },
    }),
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  const num = page.getByLabel("Số hợp đồng");
  await expect(num).toHaveValue("HĐ-7-SĐ1");
  await expect(num).toBeEnabled();
});

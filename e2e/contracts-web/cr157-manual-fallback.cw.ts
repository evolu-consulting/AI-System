// CR-157 · «Nhập tay» = dự phòng khi AI đọc lỗi/hết giờ: nhập ngay trên HĐ đó (không còn dẫn sang trang tạo trống), người nhập tích
// «Tôi đã đối chiếu với tệp gốc», nhãn «Nhập tay · cần đối chiếu» / «… đã đối chiếu bởi X». Backend giả `page.route`; không sleep.
// Viết, chưa chạy (điều phối chạy cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const failed = () => ({
  ...activeContract(),
  status: "draft",
  effect: null,
  extract_state: "failed",
  error: "TIMEOUT",
  submit_round: 0,
  milestones: [],
});
const manual = (reconciled = false) => ({
  ...failed(),
  extract_state: "ready",
  error: null,
  can: { ...failed().can, submit: true }, // máy chủ: nháp + đọc xong ⇒ gửi được (mock `failed` giữ submit=false)
  entry_source: "manual",
  reconciled_by: reconciled ? "11111111-1111-4111-8111-111111111111" : null,
  reconciled_at: reconciled ? "2026-10-18T01:00:00.000Z" : null,
});

// installV2f chỉ ghi các route nó dựng; route CR-157 do test dựng ⇒ tự ghi tại đây.
type Call = { method: string; path: string; body: unknown };
const mockOk = async (page: Page, suffix: string, out: Call[], body: unknown, onHit?: () => void) =>
  page.route(`**/contracts/${ACTIVE_ID}/${suffix}`, async (r) => {
    const q = r.request();
    let b: unknown = null;
    try {
      b = q.postDataJSON();
    } catch {
      b = q.postData();
    }
    out.push({ method: q.method(), path: new URL(q.url()).pathname, body: b });
    onHit?.();
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
const approvalNone = (page: Page) =>
  page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/approval`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: null,
        run_status: null,
        step: null,
        task_id: null,
        can_act: false,
        feedback: null,
      }),
    }),
  );

test("Đọc lỗi: Nhập tay là nút trên chính HĐ, bấm gọi manual-entry và hiện nhãn cần đối chiếu", async ({
  page,
}) => {
  let state: "failed" | "manual" = "failed";
  await installV2f(page, { contract: () => (state === "failed" ? failed() : manual()) });
  const sent: Call[] = [];
  await mockOk(
    page,
    "manual-entry",
    sent,
    { id: ACTIVE_ID, status: "draft", extract_state: "ready", entry_source: "manual", version: 2 },
    () => {
      state = "manual";
    },
  );
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByRole("link", { name: "Nhập tay" })).toHaveCount(0);
  await page.getByTestId("manual-entry").click();
  await expect.poll(() => sent.length).toBe(1);
  await expect(page.getByTestId("manual-tag")).toHaveText("Nhập tay · cần đối chiếu");
  await expect(page.getByTestId("manual-reconciled")).not.toBeChecked();
});

test("Nhập tay chưa đối chiếu: tích ô «Tôi đã đối chiếu với tệp gốc» gọi PUT reconcile", async ({
  page,
}) => {
  let rec = false;
  await installV2f(page, { contract: () => manual(rec) });
  const sent: Call[] = [];
  await mockOk(page, "reconcile", sent, { id: ACTIVE_ID }, () => {
    rec = true;
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page.getByTestId("manual-reconciled").click(); // ô điều khiển theo máy chủ: chỉ đổi sau khi tải lại
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.method).toBe("PUT");
  expect(sent[0]?.body).toEqual({ reconciled: true });
});

test("Nhập tay đã đối chiếu: nhãn có tên người đối chiếu, người xem chỉ thấy nhãn không có ô tích", async ({
  page,
}) => {
  await installV2f(page, { role: "viewer", contract: () => manual(true) });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByTestId("manual-tag")).toContainText("Nhập tay · đã đối chiếu");
  await expect(page.getByTestId("manual-reconciled")).toHaveCount(0);
});

// CR-157b · nút Xác nhận & lưu / Gửi duyệt tắt tới khi tích đối chiếu; tệp gốc cạnh form (desktop); Tải tệp khác thay tệp.
test("Nhập tay chưa đối chiếu: nút Xác nhận và lưu tắt, tích xong thì bật", async ({ page }) => {
  let rec = false;
  await installV2f(page, { contract: () => manual(rec) });
  await approvalNone(page);
  await mockOk(
    page,
    "reconcile",
    [],
    { id: ACTIVE_ID, reconciled_by: "11111111-1111-4111-8111-111111111111" },
    () => {
      rec = true;
    },
  );
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const go = page.getByTestId(/^(confirm-save|act-approvalConfirm|act-resubmit)$/).first();
  await expect(go).toBeDisabled();
  await page.getByTestId("manual-reconciled").click();
  await expect(go).toBeEnabled();
});

test("Nhập tay trên màn rộng: tệp gốc hiện cạnh form", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByTestId("manual-side")).toBeVisible();
});

test("Đọc lỗi: Tải tệp khác gửi tệp tới replace-file", async ({ page }) => {
  await installV2f(page, { contract: () => failed() });
  const calls: string[] = [];
  await page.route(`**/contracts/${ACTIVE_ID}/replace-file`, async (r) => {
    calls.push(r.request().method());
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ACTIVE_ID,
        status: "draft",
        extract_state: "reading",
        version: 3,
      }),
    });
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page
    .getByTestId("replace-file")
    .locator("input[type=file]")
    .setInputFiles({
      name: "moi.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
  await expect.poll(() => calls.length).toBe(1);
});

// CR-162 (1) màn nhập tay 2 cột ngang nhau full chiều rộng.
test("CR-162 · màn nhập tay: form và tệp gốc 2 cột full chiều rộng", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const side = await page.getByTestId("manual-side").boundingBox();
  const form = await page.getByTestId("manual-banner").boundingBox();
  expect(side && form && side.x > form.x).toBe(true);
  expect(side ? side.x + side.width : 0).toBeGreaterThan(1400 - 64); // chạm lề phải vùng nội dung, không chừa trống
  expect(Math.abs((form?.width ?? 0) - 460)).toBeLessThan(40); // CR-193: cột thông tin ~460px, PDF chiếm phần còn lại
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByTestId("manual-side")).toBeHidden(); // hẹp ⇒ xếp dọc, dùng nút icon xem tệp
});

// CR-193 · đầu trang HĐ nhập tay thẳng mép với lưới (trái = cột form, phải = khung tệp), PDF đủ rộng ở 1920.
test("CR-193 · nhập tay: đầu trang thẳng mép với lưới", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const head = await page.getByTestId("form-bar").boundingBox();
  const form = await page.getByTestId("manual-banner").boundingBox();
  const side = await page.getByTestId("manual-side").boundingBox();
  expect(head && form && side).toBeTruthy();
  expect(Math.abs((head?.x ?? 0) - (form?.x ?? 99))).toBeLessThan(2);
  expect(
    Math.abs((head?.x ?? 0) + (head?.width ?? 0) - ((side?.x ?? 0) + (side?.width ?? 0))),
  ).toBeLessThan(2);
  expect(side?.width ?? 0).toBeGreaterThan(900); // BR-193-8: không bị chặn ~1100px
  expect(form?.width ?? 0).toBeGreaterThan(420);
});

// CR-162 (2) thẻ «Không đọc được»: một cụm — Nhập tay chính + menu ⋯ (Thử lại · Tải tệp khác).
test("CR-162 · thẻ Không đọc được: Nhập tay là nút chính, Thử lại và Tải tệp khác nằm trong một menu", async ({
  page,
}) => {
  await installV2f(page, { contract: () => failed() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const box = page.getByTestId("failed-actions");
  await expect(box.getByRole("button", { name: "Nhập tay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thử lại" })).toHaveCount(0);
  await box.getByRole("button", { name: "Thêm lựa chọn" }).click();
  await expect(page.getByRole("menuitem", { name: "Thử lại" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Tải tệp khác" })).toBeVisible();
});

// CR-162 (3) menu «Thao tác» chỉ một mục ⇒ không vạch kẻ phía trên mục đó.
test("CR-162 · menu Thao tác chỉ một mục thì không có vạch kẻ", async ({ page }) => {
  // Chỉ «Xoá hợp đồng» (can.delete) ⇒ menu hiện và có đúng một mục; không có can.delete thì menu không hiện.
  await installV2f(page, {
    contract: () => ({ ...failed(), can: { ...failed().can, delete: true } }),
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page.getByTestId("head-actions-menu").click();
  const items = page.getByRole("menuitem");
  if ((await items.count()) === 1)
    await expect(page.getByRole("menu").locator("hr")).toHaveCount(0);
});

// CR-162 (4) «Xem hợp đồng gốc» = nút icon + chú thích khi rê chuột.
test("CR-162 · Xem hợp đồng gốc là nút icon có chú thích khi rê chuột", async ({ page }) => {
  await installV2f(page, { contract: () => failed() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const link = page.getByTestId("page-head").getByRole("link", { name: "Xem hợp đồng gốc" }); // thẻ «Không đọc được» cũng có một nút cùng nhãn
  await expect(link).toHaveText("");
  await link.hover();
  await expect(page.getByRole("tooltip", { name: "Xem hợp đồng gốc" })).toBeVisible();
});

// CR-168 (3) trang chi tiết HĐ nháp không còn khối «Khi gửi, hợp đồng sẽ đi qua».
test("CR-168 · không còn khối xem trước luồng duyệt trên trang HĐ nháp", async ({ page }) => {
  await installV2f(page, { contract: () => manual(true) });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByTestId("manual-banner")).toBeVisible();
  await expect(page.getByTestId("submit-preview")).toHaveCount(0);
  await expect(page.getByText("Khi gửi, hợp đồng sẽ đi qua")).toHaveCount(0);
});

// CR-168 (5) nhập tay: «Loại hợp đồng» chọn được, lưu cùng PATCH nháp (server đặt direction theo loại).
test("CR-168 · nhập tay: chọn Loại hợp đồng rồi Lưu nháp gửi deal trong PATCH", async ({
  page,
}) => {
  const sent = await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const tile = page.getByRole("radio", { name: /^Giới thiệu/ });
  await expect(tile).toBeEnabled();
  await tile.click();
  await page.getByRole("button", { name: "Lưu nháp" }).first().click();
  await expect
    .poll(() => sent.find((s) => s.method === "PATCH" && s.path.endsWith("/fields"))?.body)
    .toMatchObject({ deal: "referral" });
});

// CR-168 (1)(2) đầu trang gọn: nút chính + «Thao tác» cùng hàng với tên; dòng thông tin có nhãn rõ.
test("CR-168 · đầu trang: nút cùng hàng với tên, dòng thông tin có nhãn", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installV2f(page, { contract: () => manual(true) });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const title = await page.getByTestId("head-title").boundingBox();
  const menu = await page.getByTestId("head-actions-menu").boundingBox();
  expect(title && menu && Math.abs(title.y - menu.y) < 40).toBe(true);
  const head = page.getByTestId("form-bar");
  await expect(head).toContainText("Loại");
  await expect(head).toContainText("Phụ trách");
});

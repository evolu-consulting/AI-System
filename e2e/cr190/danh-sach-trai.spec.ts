// CR-190 · lát cr190-msg-list-ui · e2e cột trái trang Tin nhắn (stack journey thật; viết trong lát, điều phối chạy một lần cuối đợt):
// nhóm mở/thu nhớ được sau khi tải lại, tìm người/nhóm/công ty, người chưa từng nhắn bấm là mở cuộc (màn chào), tin tới ⇒ dòng lên đầu nhóm,
// «Chưa đọc» có số, «⋯» Ghim / Đánh dấu. Nhân viên là người gửi, giám đốc (khác người tạo dữ liệu) là người nhận.

import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const FROM = "E2E Nhân viên Kinh doanh";
const TAG = Date.now().toString(36);

test("nhóm mở/thu nhớ sau khi tải lại, tìm lọc đúng, người chưa nhắn bấm là mở cuộc có màn chào", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctx.newPage();
  await loginCw(a, E, U.employee);
  await a.goto("/contracts/messages");

  // thứ tự nhóm cố định: «Nhóm chat» rồi «Nội bộ» đứng sau mọi công ty đối tác
  const heads = a.getByTestId("dir-group-head");
  await expect(heads.first()).toBeVisible();
  const names = await a
    .getByTestId("dir-group")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
  expect(names.slice(-2)).toEqual(["chat", "internal"]);

  // mở/thu nhớ trên máy: đảo trạng thái «Nội bộ», tải lại, vẫn giữ
  const internal = a.locator('[data-group="internal"]').getByTestId("dir-group-head");
  const before = await internal.getAttribute("aria-expanded");
  await internal.click();
  const after = before === "true" ? "false" : "true";
  await expect(internal).toHaveAttribute("aria-expanded", after);
  await a.reload();
  await expect(a.locator('[data-group="internal"]').getByTestId("dir-group-head")).toHaveAttribute(
    "aria-expanded",
    after,
  );
  if (after === "false")
    await a.locator('[data-group="internal"]').getByTestId("dir-group-head").click();
  await expect(a.locator('[data-group="internal"]').getByTestId("conv-row").first()).toBeVisible();

  // tìm: không dấu, chỉ còn dòng khớp
  const box = a.getByRole("searchbox", { name: "Tìm người, nhóm, công ty" });
  await box.fill("giam");
  await a.getByTestId("find-tab-people").click();
  const rows = a.getByTestId("conv-row");
  await expect(rows.first()).toContainText(/giám đốc/i);
  expect(await rows.count()).toBeLessThan(5);
  await box.fill("zzzkhongco");
  await expect(a.getByText("Không có hội thoại nào khớp")).toBeVisible();
  await box.fill("");

  // người chưa từng nhắn («Chưa có tin nhắn», không giờ) ⇒ bấm là mở cuộc, khung chat hiện màn chào
  const fresh = a.getByTestId("conv-row").filter({ has: a.getByTestId("conv-empty-msg") });
  if ((await fresh.count()) > 0) {
    const row = fresh.first();
    await expect(row.locator("time")).toHaveCount(0);
    await row.click();
    await expect(a.getByTestId("chat-title")).toBeVisible();
    await expect(a.getByTestId("chat-first-hello")).toBeVisible();
  }
  await ctx.close();
});

test("tin tới ⇒ dòng của người gửi lên đầu nhóm, «Chưa đọc» có số, «⋯» đánh dấu đã đọc/chưa đọc và Ghim", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await b.goto("/contracts/messages");
  await a.goto("/contracts/messages");

  // A: tìm giám đốc trong danh bạ (chưa nhắn cũng có dòng) ⇒ bấm ⇒ gửi tin
  await a.getByRole("searchbox", { name: "Tìm người, nhóm, công ty" }).fill("giam");
  await a.getByTestId("find-tab-people").click();
  await a.getByTestId("conv-row").first().click();
  const hello = `Chào B ${TAG}`;
  await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(hello);
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").filter({ hasText: hello })).toBeVisible();

  // B (người nhận, khác người tạo): dòng của A đứng đầu nhóm «Nội bộ», có số chưa đọc, nhóm mở sẵn
  const group = b.locator('[data-group="internal"]');
  const first = group.getByTestId("conv-row").first();
  await expect(first).toContainText(FROM);
  await expect(first).toHaveAttribute("data-unread", "true");
  await expect(first.getByTestId("conv-unread")).toHaveText("1");
  await expect(group.getByTestId("dir-group-unread")).toBeVisible();
  await expect(b.getByTestId("tab-unread-n")).toHaveText("1");

  // «Chưa đọc» chỉ còn cuộc chưa đọc
  await b.getByTestId("tab-unread").click();
  await expect(b.getByTestId("conv-row").filter({ hasText: FROM })).toBeVisible();
  await b.getByTestId("tab-all").click();

  // «⋯»: đã đọc → chưa đọc (cờ) → Ghim
  const row = group.getByTestId("conv-row").filter({ hasText: FROM });
  await row.hover();
  await row.locator("xpath=..").getByTestId("conv-more").click();
  await b.getByTestId("conv-mark-read").click();
  await expect(row).toHaveAttribute("data-unread", "false");
  await row.hover();
  await row.locator("xpath=..").getByTestId("conv-more").click();
  await b.getByTestId("conv-mark-unread").click();
  await expect(row).toHaveAttribute("data-unread", "true");
  await row.hover();
  await row.locator("xpath=..").getByTestId("conv-more").click();
  await b.getByTestId("conv-pin-toggle").click();
  await expect(row.getByTestId("conv-pin")).toBeVisible();
  await expect(group.getByTestId("conv-row").first()).toContainText(FROM);

  // mở cuộc ⇒ cờ tự xoá
  await row.click();
  await expect(row).toHaveAttribute("data-unread", "false");

  await ctxA.close();
  await ctxB.close();
});

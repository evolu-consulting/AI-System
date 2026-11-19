// CR-145 · HÀNH TRÌNH THẬT (không mock) trên stack community-web (playwright.stack.config.ts, chỉ nhận `*.cs.ts`). VIẾT, CHƯA CHẠY.
// Bài đăng mặc định «Thông báo» + «Nhắc tên» (người) + chuông «nhắc bạn trong một bài».
//  P1 · Chủ quản mở ô soạn: loại mặc định là «Thông báo»; chọn người ở ô «Nhắc tên» ⇒ chip hiện tên ⇒ Đăng ⇒ bài hiện «Nhắc: …».
//  P2 · Người được nhắc (Tân Phát, KHÁC người đăng) thấy chuông «nhắc bạn trong một bài», bấm ⇒ mở đúng bài.
//  P3 · Người đăng KHÔNG nhận chuông về chính bài mình; ô «Nhắc tên» của đối tác chỉ gợi ý đồng nghiệp công ty mình (không có chủ quản).
import { expect, test } from "@playwright/test";
import { openComposer, openMentionFromBody } from "./_composer";
import { ORG, openAs, postByTitle } from "./_stack";

const RUN = Date.now().toString(36);
const TITLE = `Lịch giao hàng ${RUN}`;
test.describe.configure({ mode: "serial" });

test("CR145-P1 · chủ quản: ô soạn mặc định «Thông báo»; nhắc người Tân Phát bằng ô «Nhắc tên»; bài đăng hiện «Nhắc: …»", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await openAs(browser, "host");
  const p = host.page;
  await p.goto("/community");
  const dlg = await openComposer(p); // CR-191: «Viết bài…» ⇒ hộp thoại; loại mặc định «Thông báo» (nút có class «on»)
  await expect(dlg.locator('.seg button[data-type="note"]')).toHaveClass("on");
  await openMentionFromBody(p, dlg, TITLE); // gõ «@» trong thân bài ⇒ hộp «Nhắc tên» (không còn nút riêng)
  await p.getByRole("searchbox", { name: "Tìm theo tên" }).fill("Tân Phát");
  await p.getByTestId("mention-option").filter({ hasText: ORG.supplier }).first().click();
  await p.getByTestId("mention-done").click();
  await expect(p.getByTestId("mention-chip")).toHaveCount(1);
  await dlg.getByRole("button", { name: "Đăng bài" }).click();
  await expect(postByTitle(p, TITLE).getByTestId("post-mentions")).toContainText("Nhắc:");
  // người đăng không nhận chuông về chính bài mình
  await p.getByTestId("topbar-bell").getByRole("button").first().click();
  await expect(p.getByText(/nhắc bạn trong/)).toHaveCount(0);
  await host.ctx.close();
});

test("CR145-P2 · Tân Phát (người được nhắc, không phải người đăng) thấy chuông «nhắc bạn trong một bài», bấm ⇒ mở đúng bài", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const sup = await openAs(browser, "supplier");
  const p = sup.page;
  await p.goto("/community");
  await p.getByTestId("topbar-bell").getByRole("button").first().click();
  const item = p.getByText(/nhắc bạn trong/).first();
  await expect(item).toBeVisible({ timeout: 60_000 });
  await item.click();
  await expect(postByTitle(p, TITLE)).toBeVisible();
  await sup.ctx.close();
});

test("CR145-P3 · đối tác: ô «Nhắc tên» chỉ gợi ý đồng nghiệp công ty mình, không gợi ý chủ quản", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const sup = await openAs(browser, "supplier");
  const p = sup.page;
  await p.goto("/community");
  const dlg = await openComposer(p, "Cần bán");
  await openMentionFromBody(p, dlg);
  const options = p.getByTestId("mention-option");
  const n = await options.count();
  for (let i = 0; i < n; i++) await expect(options.nth(i)).not.toContainText(ORG.buyer);
  await sup.ctx.close();
});

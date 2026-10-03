// CHAT-AC-05..07, 18, UC-02 · gửi tin, stream, cuộn, thẻ gợi ý, quota (test-plan §6 E-S1…S5).
import { expect, test } from "@playwright/test";
import {
  composer,
  finishedContent,
  flows,
  log,
  login,
  nextSend,
  nextSendResponse,
  openConversation,
  resetMock,
  scrollerHandle,
  sendMain,
  watchGrowth,
} from "./_support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

test("CHAT-AC-05 · gửi ở ô chính tạo flow mới (không flow_id): 2 → 3 article [E-S1]", async ({
  page,
}) => {
  await openConversation(page, "Soạn email báo giá Minh Phát");
  await expect(flows(page)).toHaveCount(2);
  const body = nextSend(page);
  await sendMain(page, "Câu mới");
  const sent = await body;
  expect(sent.content).toBe("Câu mới");
  expect(sent.flow_id).toBeUndefined();
  await expect(flows(page)).toHaveCount(3);
});

test("CHAT-AC-06 · /c/new gửi 'Xin chào': chuyển /c/:id, text tăng dần, cuối = run.finished.content, Consultant [E-S2]", async ({
  page,
}) => {
  const get = await watchGrowth(page);
  const resp = nextSendResponse(page);
  await sendMain(page, "Xin chào");
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const r = await resp;
  const content = finishedContent(await r.text());
  await expect(log(page).getByText("Consultant").first()).toBeVisible();
  await expect(log(page).getByRole("img", { name: "EvoluConsulting" }).first()).toBeVisible();
  const lastLine = content.trim().split("\n").pop() ?? "";
  await expect(log(page)).toContainText(lastLine.replace(/[*_`#>|-]/g, "").trim());
  expect((await get()).length).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("link", { name: "Xin chào", exact: true })).toBeVisible();
});

test("CHAT-AC-07 · đang cuộn lên thì delta mới không kéo về đáy; '↓ Tin mới' đưa về đáy [E-S3]", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openConversation(page, "Soạn email báo giá Minh Phát");
  await sendMain(page, "#scn:slow kể chuyện");
  await expect(log(page).getByRole("article").last()).toContainText("kể chuyện");
  const sc = await scrollerHandle(page);
  await sc.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 400;
  });
  const before = await sc.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  expect(before).toBeGreaterThan(80);
  const btn = page.getByRole("button", { name: "↓ Tin mới" });
  await expect(btn).toBeVisible();
  const after = await sc.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  expect(after).toBeGreaterThan(80);
  await btn.click();
  await expect
    .poll(() => sc.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(80);
  await expect(btn).toBeHidden();
});

test("CHAT-AC-18 · bấm thẻ 'Soạn email' điền composer, focus, không gửi [E-S4]", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/conversations"))
      posts.push(r.url());
  });
  await expect(
    page.getByRole("button", { name: /^(Soạn email|Tóm tắt văn bản|Dịch|Lên dàn ý)/ }),
  ).toHaveCount(4);
  await page.getByRole("button", { name: /^Soạn email/ }).click();
  await expect(composer(page)).toHaveValue("Soạn email báo giá gửi khách hàng");
  await expect(composer(page)).toBeFocused();
  expect(posts).toHaveLength(0);
});

test("UC-02 · quota-over: hiện nhắc, 'Ẩn nhắc' ẩn được, vẫn gửi tiếp được [E-S5]", async ({
  page,
}) => {
  await sendMain(page, "#scn:quota-over hỏi nhanh");
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const hide = page.getByRole("button", { name: "Ẩn nhắc" });
  await expect(hide).toBeVisible();
  await hide.click();
  await expect(hide).toBeHidden();
  const body = nextSend(page);
  await sendMain(page, "tiếp tục");
  expect((await body).content).toBe("tiếp tục");
});

/// <reference lib="dom" />
// X1-AC04, AC05 · HUB-FR-91/92/94 · menu `@`, lỗi agent, `responder`, 429 (test-plan §2). `page.route`, không sửa mock.
import { expect, test } from "@playwright/test";
import { composer, log, login, nextSend, resetMock, sendMain } from "./_support";
import {
  AGENT_ITEMS,
  errorBody,
  MESSAGES_GET,
  routeAgents,
  routeSendError,
  routeSendPatched,
  stripLength,
} from "./_x1-support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

const menu = (page: import("@playwright/test").Page) =>
  page.getByRole("listbox", { name: "Agent" });

test("X1-AC04 · gõ '@' mở listbox 'Agent' (2 option); '@tr' lọc còn @trello; '@@x' không mở menu và gửi nguyên văn", async ({
  page,
}) => {
  await routeAgents(page);
  await composer(page).fill("@");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("option")).toHaveCount(AGENT_ITEMS.length);
  await composer(page).fill("@tr");
  await expect(menu(page).getByRole("option")).toHaveCount(1);
  await expect(menu(page).getByRole("option")).toContainText("@trello");
  await composer(page).fill("@@x");
  await expect(menu(page)).toHaveCount(0);
  const sent = nextSend(page);
  await composer(page).press("Enter");
  expect((await sent).content).toBe("@@x");
});

test("X1-AC04 · 404 AGENT_NOT_FOUND: alert 'Không tìm thấy agent @dify-chatbot2.' + button '@dify-chatbot' thay tag", async ({
  page,
}) => {
  await routeAgents(page);
  await routeSendError(
    page,
    404,
    errorBody("AGENT_NOT_FOUND", { tag: "dify-chatbot2", suggestions: ["dify-chatbot"] }),
  );
  await sendMain(page, "@dify-chatbot2 xin chào");
  const alert = page.getByRole("alert").filter({ hasText: "Không tìm thấy agent @dify-chatbot2." });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Ý bạn là:");
  await alert.getByRole("button", { name: "@dify-chatbot", exact: true }).click();
  await expect(composer(page)).toHaveValue(/^@dify-chatbot xin chào/);
});

test("X1-AC04 · tin chỉ có tag '@dify-chatbot': alert 'Hãy nhập nội dung sau @dify-chatbot.'", async ({
  page,
}) => {
  await routeAgents(page);
  await routeSendError(
    page,
    422,
    errorBody("CMD_MISSING_ARG", { name: "dify-chatbot", missing: ["content"], invalid: [] }),
  );
  await sendMain(page, "@dify-chatbot");
  await expect(
    page.getByRole("alert").filter({ hasText: "Hãy nhập nội dung sau @dify-chatbot." }),
  ).toBeVisible();
});

test("X1-AC04 · run.started có responder: nhãn người trả lời = 'Chatbot (Dify)', không còn 'Consultant'", async ({
  page,
}) => {
  await routeAgents(page);
  await routeSendPatched(page, (events) =>
    events.map((e) =>
      e.event === "run.started"
        ? { ...e, data: { ...e.data, responder: { key: "dify-chatbot", name: "Chatbot (Dify)" } } }
        : e,
    ),
  );
  // Lịch sử tải lại (Message.responder, plan-frontend §1.3) cũng mang responder để kiểm cả hai đường hiển thị.
  await page.route(MESSAGES_GET, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { items: { role: string; responder?: unknown }[] };
    for (const m of body.items) {
      if (m.role === "assistant") m.responder = { key: "dify-chatbot", name: "Chatbot (Dify)" };
    }
    await route.fulfill({ status: res.status(), headers: stripLength(res.headers()), json: body });
  });
  await sendMain(page, "@dify-chatbot xin chào");
  await expect(log(page).getByText("Chatbot (Dify)").first()).toBeVisible();
  await expect(log(page)).not.toContainText("Consultant");
});

test("X1-AC05 · 429 TOO_MANY_RUNS + Retry-After 3: alert 'Thử lại sau 3 giây.', Gửi disabled rồi bật lại, không tự gửi lại", async ({
  page,
}) => {
  const calls = await routeSendError(page, 429, errorBody("TOO_MANY_RUNS"), {
    "retry-after": "3",
  });
  await sendMain(page, "xin chào");
  const alert = page.getByRole("alert").filter({ hasText: "Thử lại sau" });
  await expect(alert).toContainText("Thử lại sau 3 giây.");
  const send = page.getByRole("button", { name: "Gửi", exact: true });
  await expect(send).toBeDisabled();
  await expect(send).toBeEnabled({ timeout: 10_000 });
  await expect(alert).toBeHidden();
  expect(calls.n).toBe(1);
});

test("X1-AC05 · Retry-After sai ('abc') ⇒ dùng mặc định 5 giây", async ({ page }) => {
  await routeSendError(page, 429, errorBody("TOO_MANY_RUNS"), { "retry-after": "abc" });
  await sendMain(page, "xin chào");
  await expect(page.getByRole("alert").filter({ hasText: "Thử lại sau 5 giây." })).toBeVisible();
});

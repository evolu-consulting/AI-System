// CHAT-AC-28, 29 · rớt stream nối lại bằng Last-Event-ID; mất kết nối Hub (test-plan §6 E-N1, E-N2).
import { expect, test } from "@playwright/test";
import { apiToken, HUB, log, login, nextSendResponse, resetMock, sendMain } from "./_support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

test("CHAT-AC-28 · stream rớt: banner 'Đang kết nối lại…', GET /runs/:id/events với last-event-id 6, câu cuối đúng 1 lần [E-N1]", async ({
  page,
}) => {
  const resume = page.waitForRequest(
    (r) => r.method() === "GET" && /\/runs\/[^/]+\/events$/.test(new URL(r.url()).pathname),
  );
  const sent = nextSendResponse(page);
  await sendMain(page, "#scn:drop x");
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const req = await resume;
  expect(req.headers()["last-event-id"]).toBe("6");
  await sent;
  const convId = new URL(page.url()).pathname.split("/").pop();
  const token = await apiToken();
  const res = await fetch(`${HUB}/conversations/${convId}/messages?limit=10`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const items = ((await res.json()) as { items: { role: string; content: string }[] }).items;
  const answer = items.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
  const lastLine =
    answer
      .trim()
      .split("\n")
      .pop()
      ?.replace(/[*_`#>|-]/g, "")
      .trim() ?? "";
  expect(lastLine.length).toBeGreaterThan(0);
  await expect(log(page)).toContainText(lastLine);
  const text = await log(page).innerText();
  expect(text.split(lastLine).length - 1).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Đang kết nối lại…" })).toBeHidden();
});

test("CHAT-AC-29 · Hub không với tới: alert 'Không kết nối được máy chủ' + Thử lại, khôi phục khi có mạng [E-N2]", async ({
  page,
}) => {
  await page.route("**/conversations**", (route) => route.abort());
  await page.reload();
  const alert = page.getByRole("alert").filter({ hasText: "Không kết nối được máy chủ" });
  await expect(alert).toBeVisible();
  await page.unroute("**/conversations**");
  await alert.getByRole("button", { name: "Thử lại" }).click();
  await expect(alert).toBeHidden();
  await expect(
    page.getByRole("link", { name: "Soạn email báo giá Minh Phát", exact: true }),
  ).toBeVisible();
});

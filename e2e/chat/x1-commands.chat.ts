/// <reference lib="dom" />
// X1-AC01, AC02 · HUB-FR-10/11/12 · menu `/` và lỗi lệnh (test-plan §2). Hub mock bị `page.route` bù `/commands` (§8 mục 4).
import { expect, test } from "@playwright/test";
import { composer, isSend, login, nextSend, resetMock, sendMain } from "./_support";
import { errorBody, routeCommands, routeSendError } from "./_x1-support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

const menu = (page: import("@playwright/test").Page) => page.getByRole("listbox", { name: "Lệnh" });

test("X1-AC01 · gõ '/' mở listbox 'Lệnh' với 3 option; '/tr' lọc còn 1; '/dich' hiện '(alias /translate)'", async ({
  page,
}) => {
  await routeCommands(page);
  await composer(page).fill("/");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("option")).toHaveCount(3);
  await composer(page).fill("/tr");
  await expect(menu(page).getByRole("option")).toHaveCount(1);
  await expect(menu(page).getByRole("option", { name: /^\/translate/ })).toBeVisible();
  await composer(page).fill("/dich");
  // test-plan ghi "(alias /translate)", plan-frontend §1.1 ghi "(alias /x)": chấp nhận cả hai chiều, cần đúng 1 dòng.
  await expect(menu(page).getByRole("option")).toHaveCount(1);
  await expect(menu(page).getByRole("option")).toContainText(/\(alias \/(dich|translate)\)/);
});

test("X1-AC01 · ↓↑ chọn vòng; Enter điền '/translate ' và KHÔNG gửi request messages; Esc đóng menu", async ({
  page,
}) => {
  await routeCommands(page);
  let sends = 0;
  page.on("request", (r) => {
    if (isSend(r)) sends += 1;
  });
  await composer(page).fill("/");
  const opts = menu(page).getByRole("option");
  await expect(opts).toHaveCount(3);
  // Sắp theo name: reply, summary, translate. ↑ từ dòng đầu quay về dòng cuối (vòng).
  await expect(opts.first()).toHaveAttribute("aria-selected", "true");
  await composer(page).press("ArrowUp");
  await expect(opts.last()).toHaveAttribute("aria-selected", "true");
  await composer(page).press("ArrowDown");
  await expect(opts.first()).toHaveAttribute("aria-selected", "true");
  await composer(page).press("ArrowUp");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("/translate ");
  await expect(menu(page)).toHaveCount(0);
  expect(sends).toBe(0);
  await composer(page).fill("/");
  await expect(menu(page)).toBeVisible();
  await composer(page).press("Escape");
  await expect(menu(page)).toHaveCount(0);
});

test("X1-AC01 · ca rỗng: 'Bạn chưa được cấp lệnh nào'", async ({ page }) => {
  await routeCommands(page, () => ({ status: 200, body: JSON.stringify({ items: [] }) }));
  await composer(page).fill("/");
  await expect(page.getByText("Bạn chưa được cấp lệnh nào")).toBeVisible();
});

test("X1-AC01 · 403 coi như rỗng: 'Bạn chưa được cấp lệnh nào'", async ({ page }) => {
  await routeCommands(page, () => ({ status: 403, body: errorBody("FORBIDDEN") }));
  await composer(page).fill("/");
  await expect(page.getByText("Bạn chưa được cấp lệnh nào")).toBeVisible();
});

test("X1-AC01 · lỗi 500: 'Không tải được danh sách lệnh' + 'Thử lại' gọi lại đúng 1 lần rồi hiện lệnh", async ({
  page,
}) => {
  const ok = JSON.stringify({ items: [] });
  const calls = await routeCommands(page, (n) =>
    n === 1 ? { status: 500, body: errorBody("INTERNAL_ERROR") } : { status: 200, body: ok },
  );
  await composer(page).fill("/");
  await expect(page.getByText("Không tải được danh sách lệnh")).toBeVisible();
  const before = calls.n;
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.getByText("Bạn chưa được cấp lệnh nào")).toBeVisible();
  expect(calls.n).toBe(before + 1);
});

test("X1-AC02 · 404 CMD_NOT_FOUND: alert 'Không có lệnh /tranlate.' + 'Ý bạn là:' + button '/translate' đổi tên lệnh trong ô", async ({
  page,
}) => {
  await routeCommands(page);
  await routeSendError(
    page,
    404,
    errorBody("CMD_NOT_FOUND", { name: "tranlate", suggestions: ["translate", "trello"] }),
  );
  await sendMain(page, "/tranlate en hello");
  const alert = page.getByRole("alert").filter({ hasText: "Không có lệnh /tranlate." });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Ý bạn là:");
  await alert.getByRole("button", { name: "/translate", exact: true }).click();
  await expect(composer(page)).toHaveValue(/^\/translate en hello/);
  await expect(composer(page)).toBeFocused();
});

test("X1-AC02 · 422 CMD_MISSING_ARG: alert 'Lệnh /translate thiếu: text.'", async ({ page }) => {
  await routeCommands(page);
  await routeSendError(
    page,
    422,
    errorBody("CMD_MISSING_ARG", { name: "translate", missing: ["text"], invalid: [] }),
  );
  await sendMain(page, "/translate en");
  await expect(
    page.getByRole("alert").filter({ hasText: "Lệnh /translate thiếu: text." }),
  ).toBeVisible();
});

test("X1-AC02 · D3: gõ '//x' không mở menu và gửi content '//x' nguyên văn", async ({ page }) => {
  await routeCommands(page);
  await composer(page).fill("//x");
  await expect(menu(page)).toHaveCount(0);
  const sent = nextSend(page);
  await composer(page).press("Enter");
  expect((await sent).content).toBe("//x");
});

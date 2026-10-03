// CHAT-AC-14..17 · khung flow bên phải / sheet mobile (test-plan §6 E-F1…F5).
import { expect, type Page, test } from "@playwright/test";
import { flows, login, nextSend, openConversation, resetMock } from "./_support";

const SEED = "Soạn email báo giá Minh Phát";
const PANEL = { name: "Flow đang mở" };

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

async function replyInFlow(page: Page, index: number): Promise<void> {
  await flows(page).nth(index).getByRole("button", { name: "Trả lời tiếp" }).click();
}

test("CHAT-AC-14 · Trả lời tiếp mở complementary 'Flow đang mở', focus ô nhập, URL ?flow= [E-F1]", async ({
  page,
}) => {
  await openConversation(page, SEED);
  await replyInFlow(page, 1);
  const panel = page.getByRole("complementary", PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Consultant");
  await expect(panel.getByRole("textbox", { name: "Tin nhắn trong flow" })).toBeFocused();
  await expect(page).toHaveURL(/[?&]flow=[0-9a-f-]{36}/);
});

test("CHAT-AC-15 · gửi trong khung có flow_id đúng, số article không đổi, footer cập nhật [E-F2]", async ({
  page,
}) => {
  await openConversation(page, SEED);
  const flow = flows(page).nth(1);
  const flowId = await flow.getAttribute("data-flow-id");
  const before = await flow.innerText();
  await replyInFlow(page, 1);
  const panel = page.getByRole("complementary", PANEL);
  await panel.getByRole("textbox", { name: "Tin nhắn trong flow" }).fill("Thêm một ý nữa");
  const body = nextSend(page);
  await panel.getByRole("button", { name: "Gửi trong flow" }).click();
  expect((await body).flow_id).toBe(flowId);
  await expect(panel).toContainText("Flow này có");
  await expect(flows(page)).toHaveCount(2);
  await expect.poll(async () => flow.innerText()).not.toBe(before);
});

test("CHAT-AC-16 · flow nghỉ lâu: 'Đang mở lại flow…' hiện rồi ẩn khi có chữ [E-F3]", async ({
  page,
}) => {
  await openConversation(page, "Hoá đơn tháng 9 cần đối chiếu");
  await replyInFlow(page, 0);
  const panel = page.getByRole("complementary", PANEL);
  await panel.getByRole("textbox", { name: "Tin nhắn trong flow" }).fill("Đối chiếu tiếp giúp tôi");
  await panel.getByRole("button", { name: "Gửi trong flow" }).click();
  const cold = page
    .getByRole("status")
    .filter({ hasText: "Đang mở lại flow, lần đầu có thể mất vài giây…" });
  await expect(cold).toBeVisible();
  await expect(panel).toContainText("Flow này có");
  await expect(cold).toBeHidden();
});

test.describe("mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("CHAT-AC-17 · sheet đáy 'Flow đang mở', ✕ đóng và bỏ ?flow [E-F4]", async ({ page }) => {
    await openConversation(page, SEED);
    await replyInFlow(page, 1);
    const sheet = page.getByRole("dialog", PANEL);
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(844 - 2);
    await page.getByRole("button", { name: "Đóng khung flow" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]flow=/);
  });

  test("CHAT-AC-17 · kéo tay nắm xuống 200px thì sheet đóng [E-F5]", async ({ page }) => {
    await openConversation(page, SEED);
    await replyInFlow(page, 1);
    const sheet = page.getByRole("dialog", PANEL);
    await expect(sheet).toBeVisible();
    const grip = await page.getByRole("button", { name: "Kéo để đóng" }).boundingBox();
    if (!grip) throw new Error("không thấy tay nắm 'Kéo để đóng'");
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 100, { steps: 5 });
    await page.mouse.move(x, y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(sheet).toBeHidden();
  });
});

/// <reference lib="dom" />
// CHAT-AC-08..13 · bước, dừng, chạy lại, hỏi lại (test-plan §6 E-T1…T7).
import { expect, type Page, test } from "@playwright/test";
import { flows, log, login, nextSend, nextSendResponse, resetMock, sendMain } from "./_support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

type Seen = { busy: boolean; texts: string[] };

/** Ghi mọi `listitem` từng xuất hiện (kể cả `aria-busy`) — E-T1 không phụ thuộc polling (test-plan M5). */
async function watchSteps(page: Page): Promise<() => Promise<Seen>> {
  await page.evaluate(() => {
    const w = window as unknown as { __steps: { busy: boolean; texts: Set<string> } };
    w.__steps = { busy: false, texts: new Set() };
    const rec = (): void => {
      for (const li of document.querySelectorAll('[role="log"] li')) {
        w.__steps.texts.add((li as HTMLElement).innerText.replace(/\s+/g, " ").trim());
        if (li.getAttribute("aria-busy") === "true") w.__steps.busy = true;
      }
    };
    new MutationObserver(rec).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  return () =>
    page.evaluate(() => {
      const s = (window as unknown as { __steps: { busy: boolean; texts: Set<string> } }).__steps;
      return { busy: s.busy, texts: [...s.texts] };
    });
}

async function runSteps(page: Page): Promise<() => Promise<Seen>> {
  const get = await watchSteps(page);
  await sendMain(page, "#scn:steps viết email");
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  await expect(page.getByRole("button", { name: /2 bước · 7,8s/ })).toBeVisible();
  return get;
}

test("CHAT-AC-08 · bước hiện lúc chạy (aria-busy) rồi có thời lượng 2,1s / 5,7s, không lộ agent/provider [E-T1]", async ({
  page,
}) => {
  const seen = await (await runSteps(page))();
  expect(seen.busy).toBe(true);
  const all = seen.texts.join(" | ");
  expect(all).toMatch(/Hiểu yêu cầu.*2,1s/);
  expect(all).toMatch(/Đang viết email.*5,7s/);
  expect(await log(page).innerText()).not.toMatch(/agent|provider/i);
});

test("CHAT-AC-09 · '✓ 2 bước · 7,8s' đóng/mở bằng aria-expanded và list 'Các bước' [E-T2]", async ({
  page,
}) => {
  await runSteps(page);
  const toggle = page.getByRole("button", { name: /2 bước · 7,8s/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("list", { name: "Các bước" })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

async function startSlowThenStop(page: Page, how: "button" | "esc"): Promise<string> {
  await sendMain(page, "#scn:slow kể chuyện dài");
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const running = log(page).locator("[data-run-id]").first();
  await expect(running).toBeVisible();
  const runId = (await running.getAttribute("data-run-id")) ?? "";
  await expect(log(page).getByRole("article").last()).toContainText(/\S{3,}\s+\S{3,}/);
  const cancel = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/runs/${runId}/cancel`),
  );
  if (how === "button") await page.getByRole("button", { name: "Dừng" }).click();
  else await page.keyboard.press("Escape");
  await cancel;
  return runId;
}

for (const [how, code] of [
  ["button", "T3"],
  ["esc", "T4"],
] as const) {
  test(`CHAT-AC-10 · dừng bằng ${how === "button" ? "nút Dừng" : "phím Esc"}: cancel, 'Đã dừng', Chạy lại, Gửi trở lại [E-${code}]`, async ({
    page,
  }) => {
    await startSlowThenStop(page, how);
    await expect(page.getByText("Đã dừng")).toBeVisible();
    await expect(page.getByRole("button", { name: "Chạy lại" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Gửi", exact: true })).toBeVisible();
    await expect(log(page).getByRole("article").last()).toContainText(/\S{3,}/);
  });
}

test("CHAT-AC-11 · Chạy lại gửi nguyên văn câu gốc (kể cả #scn), không flow_id, run mới [E-T5]", async ({
  page,
}) => {
  const first = nextSendResponse(page);
  const oldRun = await startSlowThenStop(page, "button");
  expect((await first).headers()["x-run-id"]).toBe(oldRun);
  await expect(page.getByRole("button", { name: "Chạy lại" })).toBeVisible();
  const body = nextSend(page);
  const second = nextSendResponse(page);
  await page.getByRole("button", { name: "Chạy lại" }).click();
  const sent = await body;
  expect(sent.content).toBe("#scn:slow kể chuyện dài");
  expect(sent.flow_id).toBeUndefined();
  expect((await second).headers()["x-run-id"]).not.toBe(oldRun);
});

test("CHAT-AC-12 · kịch bản ask hiện region 'Consultant cần thêm thông tin' với 2 chip [E-T6]", async ({
  page,
}) => {
  await sendMain(page, "#scn:ask tóm tắt họp");
  const ask = page.getByRole("region", { name: "Consultant cần thêm thông tin" });
  await expect(ask).toContainText("Bạn muốn tóm tắt cuộc họp nào?");
  await expect(ask.getByRole("button")).toHaveCount(2);
});

test("CHAT-AC-13 · bấm chip gửi ngay cùng flow_id, chip bị disabled [E-T7]", async ({ page }) => {
  await sendMain(page, "#scn:ask tóm tắt họp");
  const ask = page.getByRole("region", { name: "Consultant cần thêm thông tin" });
  const chip = ask.getByRole("button", { name: "Họp giao ban sáng nay" });
  await expect(chip).toBeVisible();
  const flowId = await flows(page).first().getAttribute("data-flow-id");
  const body = nextSend(page);
  await chip.click();
  expect(await body).toEqual({ content: "Họp giao ban sáng nay", flow_id: flowId });
  await expect(chip).toBeDisabled();
});

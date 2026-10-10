// CHAT-AC-54 · HUB-FR-112 · e2e P-a PF3 · E-P11 (test-plan-e2e §2; plan-frontend-e2e §1 Sidebar): T (Group Kế toán, ngoài
// phòng) có việc kiểm ⇒ `button "Chờ tôi kiểm"` + huy hiệu `process-todo-badge` = 1, `link "Đọc hoá đơn · Hoá đơn T"` tới
// `/runs/<id>?task=`; B (cùng Group, trong phòng) bấm Đạt ⇒ mục của T biến mất không reload, huy hiệu ẩn/0.
import { expect, test } from "@playwright/test";
import { flowPane, mkRoom, passBtn, seedRun, settle, users } from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-54 · E-P11 · T có việc ⇒ "Chờ tôi kiểm" huy hiệu 1, link "Đọc hoá đơn · Hoá đơn T" tới /runs/<id>?task=; B Đạt ⇒ mục của T biến mất không reload, huy hiệu ẩn', async ({
  browser,
}) => {
  const room = await mkRoom("EP11");
  const r = await seedRun(room.id, "waiting_review");
  const u = await users(browser, "B", "T");
  try {
    await u.T.goto("/c/new");
    const trig = u.T.getByRole("button", { name: "Chờ tôi kiểm" });
    await expect(trig).toBeVisible();
    await expect(u.T.getByTestId("process-todo-badge")).toHaveText("1");
    if ((await trig.getAttribute("aria-expanded")) !== "true") await trig.click();
    const item = u.T.getByRole("link", { name: "Đọc hoá đơn · Hoá đơn T" });
    await expect(item).toHaveAttribute("href", new RegExp(`/runs/${r.runId}\\?task=`));

    await u.B.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    await passBtn(flowPane(u.B).getByRole("region", { name: "Kiểm Đọc hoá đơn" })).click();
    await expect(item).toHaveCount(0);
    await expect(u.T.getByTestId("process-todo-badge")).toBeHidden();
    await expect(u.T.getByText("Không có việc nào chờ bạn")).toBeVisible();
  } finally {
    await u.close();
  }
});

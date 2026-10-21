// M2-chat · e2e khoang trợ lý AI của contracts-web (app mgmt): mở bằng nút nổi, hỏi ⇒ tạo hội thoại Hub (E6) + gửi tin tag
// `@assistant` (trợ lý chung, one-agent) kèm trang đang mở + ngữ cảnh dock (E12, stream SSE) ⇒ câu trả lời Markdown (đậm, bảng); câu thứ hai cùng flow; Hub từ chối
// agent (404 AGENT_NOT_FOUND) ⇒ câu "chưa được dùng". Backend giả bằng `page.route` (như `bell.cw.ts`).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chế độ chụp tham chiếu mgmt-app");

const CONV = "c2000000-0000-4000-8000-000000000001";
const FLOW = "f2000000-0000-4000-8000-000000000001";
const RUN = "a2000000-0000-4000-8000-000000000001";
const MSG = "b2000000-0000-4000-8000-000000000001";
const ANSWER =
  "Có **2 hợp đồng** sắp hết hạn:\n\n| Hợp đồng | Hết hạn |\n|---|---|\n| HĐ Bao bì | 2026-11-30 |";

type Api = { convs: unknown[]; sends: { content: string; flow_id?: string; context?: unknown }[] };
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function sse(answer: string): string {
  const evs = [
    ["run.started", { run_id: RUN, flow_id: FLOW, quota: { state: "ok", pct: 1 } }],
    ["step.started", { step_id: "s1", label: "Đang tra cứu" }],
    ["delta", { text: answer.slice(0, 10) }],
    ["delta", { text: answer.slice(10) }],
    ["run.finished", { run_id: RUN, message_id: MSG, content: answer, ms: 120 }],
  ] as const;
  return evs
    .map(([e, d], i) => `id: ${i + 1}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
    .join("");
}

async function install(page: Page, o: { forbidden?: boolean } = {}): Promise<Api> {
  const d = asHub("editor");
  const api: Api = { convs: [], sends: [] };
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(
    (u) => u.pathname === "/conversations",
    (r) => {
      api.convs.push(r.request().postDataJSON());
      return json(r, 201, { id: CONV, title: "x" });
    },
  );
  await page.route(
    (u) => u.pathname === `/conversations/${CONV}/messages`,
    (r) => {
      api.sends.push(r.request().postDataJSON());
      if (o.forbidden) return json(r, 404, { error: { code: "AGENT_NOT_FOUND", message: "x" } });
      return r.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "X-Run-Id": RUN, "X-Flow-Id": FLOW, "X-Message-Id": MSG },
        body: sse(ANSWER),
      });
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem("ai.locale", "vi");
    localStorage.setItem("assistant:open", "0");
  });
  return api;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Trợ lý AI" });

test("M2-chat · mở trợ lý, hỏi ⇒ hội thoại Hub + tin @assistant kèm trang; trả lời Markdown; câu sau cùng flow", async ({
  page,
}) => {
  const api = await install(page);
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
  const p = panel(page);
  await expect(p.getByText("Hợp đồng nào sắp hết hạn trong 60 ngày?")).toBeVisible();
  await p.getByRole("button", { name: "Hợp đồng nào sắp hết hạn trong 60 ngày?" }).click();
  await expect(p.locator("b", { hasText: "2 hợp đồng" })).toBeVisible();
  await expect(p.getByRole("cell", { name: "HĐ Bao bì" })).toBeVisible();
  await expect(p.getByText("Sẵn sàng")).toBeVisible();
  expect(api.convs).toEqual([{ title: "Hợp đồng nào sắp hết hạn trong 60 ngày?" }]);
  expect(api.sends[0]?.content).toBe("@assistant Hợp đồng nào sắp hết hạn trong 60 ngày?");
  const ctx = (api.sends[0]?.context ?? {}) as { page_url?: string; surface?: string };
  expect(ctx.page_url ?? "").toContain("/contracts");
  expect(ctx.surface).toBe("contracts"); // one-agent · Hub dựng khối ngữ cảnh nơi gửi
  expect(api.sends[0]?.flow_id).toBeUndefined();

  const box = p.getByRole("textbox", { name: "Câu hỏi cho trợ lý" });
  await box.fill("Còn hợp đồng mua?");
  await box.press("Enter");
  await expect(p.getByText("Còn hợp đồng mua?")).toBeVisible();
  await expect.poll(() => api.sends.length).toBe(2);
  expect(api.sends[1]).toMatchObject({
    content: "@assistant Còn hợp đồng mua?",
    flow_id: FLOW,
  });
  expect(api.convs).toHaveLength(1);
});

test("M2-chat · Hub không cho dùng agent (404 AGENT_NOT_FOUND) ⇒ câu 'chưa được dùng trợ lý'", async ({
  page,
}) => {
  await install(page, { forbidden: true });
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
  const box = panel(page).getByRole("textbox", { name: "Câu hỏi cho trợ lý" });
  await box.fill("Xin chào");
  await box.press("Enter");
  await expect(panel(page).getByRole("alert")).toContainText("Bạn chưa được dùng trợ lý AI");
});

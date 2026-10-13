// HUB-FR-134 · HUB-FR-132 · K1-AC06 (vế UI) · Q3 · D14 · plan-frontend K1 §2 (Output stage), §4 (Hạ cấp, Output), §5 ·
// test-plan K1 §4 E30–E31: chat-web trang Run hiện `KnowledgeNotice` khi `StageView.knowledge` có — Alert (status) "Không truy
// cập được KnowledgeHub — stage đã chạy không có tri thức." + lý do + "Tri thức: n/5 lần hỏi" + "Tóm tắt: …"; vắng ⇒ không
// render. Run seed P-b2 (a) bằng SQL; `GET /process-runs/:id` của Hub thật được vá thêm `knowledge` bằng `page.route`.
import { expect, type Page, test } from "@playwright/test";
import { mkRoom, seedPb2Run, settle, users } from "../../P-b2/_pb2-support";

test.afterEach(() => settle());

// biome-ignore lint/suspicious/noExplicitAny: view JSON theo contract
type Json = any;
async function patchView(p: Page, runId: string, knowledge: Json | null): Promise<void> {
  await p.route(new RegExp(`/process-runs/${runId}(\\?.*)?$`), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    if (knowledge && Array.isArray(body?.stages) && body.stages[0])
      body.stages[0].knowledge = knowledge;
    return route.fulfill({ response: res, json: body });
  });
}

test("HUB-FR-134 · K1-AC06 · E30 · stage hạ cấp (ns_suspended) ⇒ status 'Không truy cập được KnowledgeHub…' + 'Namespace đang bị tạm ngưng' + 'Tri thức: 2/5 lần hỏi' + 'Tóm tắt: đang chờ'", async ({
  browser,
}) => {
  const room = await mkRoom("EK1-30");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A");
  try {
    await patchView(u.A, r.runId, {
      project_id: "proj-a",
      read_only: false,
      queries: 2,
      query_limit: 5,
      warning: "ns_suspended",
      summary: "pending",
    });
    await u.A.goto(`/runs/${r.runId}`);
    const notice = u.A.getByRole("status").filter({ hasText: "Không truy cập được KnowledgeHub" });
    await expect(notice).toContainText(
      "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức.",
    );
    await expect(notice).toContainText("Namespace đang bị tạm ngưng");
    await expect(u.A.getByText("Tri thức: 2/5 lần hỏi")).toBeVisible();
    await expect(u.A.getByText("Tóm tắt: đang chờ")).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("HUB-FR-132 · E31 · knowledge vắng ⇒ không có KnowledgeNotice; knowledge không cảnh báo ⇒ chỉ dòng 'Tri thức: 0/5 lần hỏi · Tóm tắt: đã ghi'", async ({
  browser,
}) => {
  const room = await mkRoom("EK1-31");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A");
  try {
    const view = u.A.waitForResponse(
      (x) => x.request().method() === "GET" && x.url().includes(`/process-runs/${r.runId}`),
    );
    await u.A.goto(`/runs/${r.runId}`);
    expect((await view).status()).toBe(200);
    await expect(u.A.getByText("Rà soát code").first()).toBeVisible();
    await expect(u.A.getByText(/Tri thức: \d+\/5 lần hỏi/)).toHaveCount(0);
    await patchView(u.A, r.runId, {
      project_id: "proj-a",
      read_only: false,
      queries: 0,
      query_limit: 5,
      warning: null,
      summary: "written",
    });
    await u.A.reload();
    await expect(u.A.getByText("Tri thức: 0/5 lần hỏi")).toBeVisible();
    await expect(u.A.getByText("Tóm tắt: đã ghi")).toBeVisible();
    await expect(
      u.A.getByRole("status").filter({ hasText: "Không truy cập được KnowledgeHub" }),
    ).toHaveCount(0);
  } finally {
    await u.close();
  }
});

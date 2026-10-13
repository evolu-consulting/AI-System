// HUB-FR-134 · HUB-FR-132 · HUB-FR-133 · K1-AC06 (vế UI) · CR-073 · Q3 · D6/D9 · plan-frontend K1 §2 (màn 5), §4 (Hạ cấp, Output), §5 ·
// test-plan K1 §4 E30–E31: chat-web trang Run hiện `KnowledgeNotice` khi `StageView.knowledge` có — Alert (status) "Không truy
// cập được KnowledgeHub — stage đã chạy không có tri thức." + lý do + "Tri thức: n/5 lần hỏi" + "Tóm tắt: …" + "(ghi vào {project}
// · {connection})"; vắng ⇒ không render. Run seed P-b2 (a) bằng SQL (stack thử nghiệm riêng, không phải dữ liệu evolu); `GET
// /process-runs/:id` của Hub thật được vá thêm `knowledge` bằng `page.route`.
import { expect, type Page, test } from "@playwright/test";
import { withSql } from "../../P-a/_pa-support";
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

test("HUB-FR-134 · K1-AC06 · E30 · stage hạ cấp (unreachable) ⇒ status 'Không truy cập được KnowledgeHub…' + 'Không kết nối được' + 'Tri thức: 2/5 lần hỏi' + 'Tóm tắt: đang chờ' + đích ghi", async ({
  browser,
}) => {
  const room = await mkRoom("EK1-30");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A");
  try {
    await patchView(u.A, r.runId, {
      write_to: { connection: "kh-main", project: "proj-a" },
      queries: 2,
      query_limit: 5,
      warning: "unreachable",
      summary: "pending",
    });
    await u.A.goto(`/runs/${r.runId}`);
    const notice = u.A.getByRole("status").filter({ hasText: "Không truy cập được KnowledgeHub" });
    await expect(notice).toContainText(
      "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức.",
    );
    await expect(notice).toContainText("Không kết nối được");
    await expect(u.A.getByText("Tri thức: 2/5 lần hỏi")).toBeVisible();
    await expect(u.A.getByText("Tóm tắt: đang chờ")).toBeVisible();
    await expect(u.A.getByText("(ghi vào proj-a · kh-main)")).toBeVisible();
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
      write_to: { connection: "kh-main", project: "proj-a" },
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

// UAT 2026-10-13 M1: run TUYẾN TÍNH (mỗi stage một bước, chưa quay lại) vẫn phải hiện KnowledgeNotice.
test("HUB-FR-131 · HUB-FR-132 · K1-AC06 · E32 · run tuyến tính (không song song, không quay lại) có knowledge.queries=1 ⇒ 'Tri thức: 1/5 lần hỏi'", async ({
  browser,
}) => {
  const room = await mkRoom("EK1-32");
  const r = await seedPb2Run(room.id, "a");
  // biến seed "a" thành tuyến tính: mỗi stage một step riêng (0,1,2,3), step hiện tại = 1
  await withSql(async (sql) => {
    const [row] = await sql`select snapshot from hub.process_runs where id = ${r.runId}`;
    const snap = row?.snapshot;
    // biome-ignore lint/suspicious/noExplicitAny: snapshot JSON
    snap.stages.forEach((st: any, i: number) => {
      st.step = i;
    });
    await sql`update hub.process_runs set snapshot = ${sql.json(snap)} where id = ${r.runId}`;
  });
  const u = await users(browser, "A");
  try {
    await patchView(u.A, r.runId, {
      write_to: { connection: "kh-main", project: "proj-a" },
      queries: 1,
      query_limit: 5,
      warning: null,
      summary: "written",
    });
    await u.A.goto(`/runs/${r.runId}`);
    await expect(u.A.getByText("Tri thức: 1/5 lần hỏi")).toBeVisible();
  } finally {
    await u.close();
  }
});

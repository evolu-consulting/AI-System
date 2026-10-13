// HUB-FR-134 · HUB-FR-133 · K1-AC06 (vế UI) · CR-073 · plan-frontend K1 §2 (màn 5: admin OutputDialog), §4 (Hạ cấp, Output), §5 ·
// test-plan K1 §4 E20–E21: admin-web → Lượt chạy (`/processes/:id/runs/:runId`) → [Xem kết quả] ⇒ dialog "Kết quả giai đoạn …"
// hiện `KnowledgeNotice` khi `StageView.knowledge` có; vắng ⇒ không render. Stack P-b2 thật (run seed (a), def `pb2-par` —
// dữ liệu thử nghiệm riêng, không phải evolu); `GET /process-runs/:id` của Hub được vá thêm `knowledge` bằng `page.route`.
// Đỏ trước code: dòng "Tri thức: …" / status "Không truy cập được KnowledgeHub" chưa có ⇒ đỏ ở locator.
import { expect, type Page, test } from "@playwright/test";
import { adminLogin, DEF_PAR, mkRoom, seedPb2Run, settle } from "../../P-b2/_pb2-support";

test.afterEach(() => settle());

// biome-ignore lint/suspicious/noExplicitAny: view JSON theo contract
type Json = any;
async function patchView(p: Page, runId: string, knowledge: Json | null): Promise<void> {
  await p.route(new RegExp(`/process-runs/${runId}(\\?.*)?$`), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    if (knowledge && Array.isArray(body?.stages))
      for (const s of body.stages) if ((s?.outputs ?? []).length > 0) s.knowledge = knowledge;
    return route.fulfill({ response: res, json: body });
  });
}
async function openOutput(p: Page, runId: string): Promise<ReturnType<Page["getByRole"]>> {
  await adminLogin(p);
  await p.goto(`/processes/${DEF_PAR.id}/runs/${runId}`);
  await p.getByRole("button", { name: "Xem kết quả" }).first().click();
  const dlg = p.getByRole("dialog", { name: /Kết quả giai đoạn/ });
  await expect(dlg).toBeVisible();
  return dlg;
}

test("HUB-FR-134 · K1-AC06 · E20 · OutputDialog: warning timeout ⇒ status 'Không truy cập được KnowledgeHub…' + 'Hết thời gian chờ'; 'Tri thức: 3/5 lần hỏi'; 'Tóm tắt: lỗi'", async ({
  page,
}) => {
  const room = await mkRoom("EK1-20");
  const r = await seedPb2Run(room.id, "a");
  await patchView(page, r.runId, {
    write_to: { connection: "kh-main", project: "proj-a" },
    queries: 3,
    query_limit: 5,
    warning: "timeout",
    summary: "failed",
  });
  const dlg = await openOutput(page, r.runId);
  const notice = dlg.getByRole("status").filter({ hasText: "Không truy cập được KnowledgeHub" });
  await expect(notice).toContainText(
    "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức.",
  );
  await expect(notice).toContainText("Hết thời gian chờ");
  await expect(dlg.getByText("Tri thức: 3/5 lần hỏi")).toBeVisible();
  await expect(dlg.getByText("Tóm tắt: lỗi")).toBeVisible();
  expect(r.ready).toBe(true);
});

test("HUB-FR-133 · E21 · OutputDialog: knowledge vắng ⇒ không có dòng tri thức; không cảnh báo + chưa có đích ⇒ 'Tri thức: 1/5 lần hỏi', 'Tóm tắt: không ghi', không Alert", async ({
  page,
}) => {
  const room = await mkRoom("EK1-21");
  const r = await seedPb2Run(room.id, "a");
  const dlg0 = await openOutput(page, r.runId);
  await expect(dlg0.getByText(/Tri thức: \d+\/5 lần hỏi/)).toHaveCount(0);
  await patchView(page, r.runId, {
    write_to: null,
    queries: 1,
    query_limit: 5,
    warning: null,
    summary: "none",
  });
  await page.reload();
  await page.getByRole("button", { name: "Xem kết quả" }).first().click();
  const dlg = page.getByRole("dialog", { name: /Kết quả giai đoạn/ });
  await expect(dlg.getByText("Tri thức: 1/5 lần hỏi")).toBeVisible();
  await expect(dlg.getByText("Tóm tắt: không ghi")).toBeVisible();
  await expect(
    dlg.getByRole("status").filter({ hasText: "Không truy cập được KnowledgeHub" }),
  ).toHaveCount(0);
});

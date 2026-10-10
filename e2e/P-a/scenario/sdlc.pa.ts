// SC-1 · HUB-FR-105…113 · e2e P-a kịch bản (cổng merge PF4 + `done:pa`) · E-S2 (test-plan-e2e §2; plan-seed `sdlc` 8 giai đoạn):
// mẫu `sdlc` chép cho acme (PO = {B}, Tech lead = {B, T}). A "!sdlc Thêm xuất CSV" ở R ⇒ Intake hỏi lại ⇒ A nhờ H trả lời ⇒ H
// trả lời ⇒ Intake output ⇒ B Đạt (cổng 1) ⇒ 2–4 tự chạy ⇒ 5 Sẵn sàng ⇒ T Chưa đạt "Thiếu ma trận luật" ⇒ v2 ⇒ T Đạt (cổng 2)
// ⇒ 6–7 tự chạy ⇒ 8 Review ⇒ B Đạt (cổng 3) ⇒ khối "Xong"; thread có tin kết quả task của B, T, H; tab Token 8 hàng.
import { expect, type Page, test } from "@playwright/test";
import {
  copyTemplate,
  failBtn,
  flowPane,
  mkRoom,
  outputMsg,
  PA_E2E,
  passBtn,
  rtScript,
  settle,
  startUi,
  taskResult,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

/** T (ngoài phòng) mở việc kiểm đầu tiên trong "Chờ tôi kiểm". */
async function openTodo(p: Page): Promise<void> {
  await p.goto("/c/new");
  const trig = p.getByRole("button", { name: "Chờ tôi kiểm" });
  if ((await trig.getAttribute("aria-expanded")) !== "true") await trig.click();
  await p
    .getByRole("link", { name: /· Phát triển tính năng/ })
    .first()
    .click();
}

test('SC-1 · E-S2 · sdlc: 3 cổng (B, T, B), nhờ trả lời A→H ở Intake, Chưa đạt ở Sẵn sàng (T) ⇒ v2; khối "Xong"; thread có kết quả task của B, T, H; tab Token 8 hàng', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await copyTemplate("sdlc", [PA_E2E.gPO, PA_E2E.gTech, PA_E2E.gTech]);
  await rtScript("sdlc", 0, [
    { kind: "ask", question: "Định dạng CSV dùng dấu phân cách nào?", choices: [] },
  ]);
  // Giai đoạn 6 "Implement" là nhóm 2 thành viên cùng mục: runtime giả trả md giống nhau ⇒ engine dừng `team_no_change`.
  // Mỗi thành viên trả nội dung khác nhau (tag) để bản ghép thay đổi sau mỗi lượt.
  await rtScript("sdlc", 5, [
    { kind: "done", tag: "BE" },
    { kind: "done", tag: "FE" },
  ]);
  const room = await mkRoom("ES2");
  const u = await users(browser, "A", "B", "T", "H");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!sdlc Thêm xuất CSV");
    const name = /Phát triển tính năng/;
    const blk = u.A.getByRole("log", { name: "Tin nhắn của phòng" }).getByRole("article", {
      name: name,
    });
    await blk.getByRole("button", { name: "Trả lời" }).click();
    const pa = flowPane(u.A);

    // Intake hỏi lại ⇒ nhờ H
    await pa.getByRole("button", { name: "Nhờ người khác trả lời" }).click();
    const dlg = u.A.getByRole("dialog", { name: "Nhờ ai trả lời?" });
    await dlg.getByRole("searchbox", { name: "Tìm người" }).fill("QC Người 01");
    await dlg.getByRole("checkbox", { name: "QC Người 01" }).check();
    await dlg.getByRole("button", { name: "Nhờ trả lời" }).click();
    await u.H.getByRole("link", { name: "Quy trình", exact: true }).click();
    await u.H.getByRole("main").getByRole("link").first().click();
    await u.H.getByRole("textbox", { name: "Câu trả lời" }).fill("Dấu phẩy");
    await u.H.getByRole("button", { name: "Gửi trả lời" }).click();
    await expect(taskResult(pa, "QC Người 01", "Đã trả lời")).toBeVisible();

    // cổng 1: B (PO) ở thread
    await u.B.goto(`/rooms/${room.id}`);
    await u.B.getByRole("log", { name: "Tin nhắn của phòng" })
      .getByRole("article", { name: name })
      .getByRole("button", { name: "Kiểm ngay" })
      .click();
    await passBtn(flowPane(u.B).getByRole("region", { name: "Kiểm Intake" })).click();

    // cổng 2: T (ngoài phòng) Chưa đạt ⇒ v2 ⇒ Đạt
    await openTodo(u.T);
    const g2 = u.T.getByRole("region", { name: "Kiểm Sẵn sàng" });
    await failBtn(g2).click();
    await u.T.getByRole("textbox", { name: /^Góp ý cho / }).fill("Thiếu ma trận luật");
    await u.T.getByRole("button", { name: /Gửi góp ý/ }).click();
    await expect(outputMsg(pa, "Sẵn sàng", 2)).toBeVisible({ timeout: 30_000 });
    await openTodo(u.T);
    await passBtn(u.T.getByRole("region", { name: "Kiểm Sẵn sàng" })).click();

    // cổng 3: B Review
    await u.B.goto(`/rooms/${room.id}`);
    const kb = u.B.getByRole("log", { name: "Tin nhắn của phòng" }).getByRole("article", {
      name: name,
    });
    await kb.getByRole("button", { name: "Kiểm ngay" }).click({ timeout: 60_000 });
    await passBtn(flowPane(u.B).getByRole("region", { name: "Kiểm Review" })).click();

    await expect(blk).toContainText("Xong", { timeout: 30_000 });
    for (const [who, r] of [
      ["Hoa", "Đạt"],
      ["Thomas", "Chưa đạt"],
      ["Thomas", "Đạt"],
      ["QC Người 01", "Đã trả lời"],
    ] as const)
      await expect(taskResult(pa, who, r).first()).toBeVisible();

    await u.A.goto(`/runs/${runId}?tab=token`);
    const rows = u.A.getByRole("table", { name: "Token theo giai đoạn" }).getByRole("row");
    // tiêu đề + 8 giai đoạn + hàng tổng
    await expect(rows).toHaveCount(10);
  } finally {
    await u.close();
  }
});

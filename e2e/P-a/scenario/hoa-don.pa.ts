// SC-2 · AC-H31 · HUB-FR-109 · e2e P-a kịch bản (cổng merge PF4 + `done:pa`) · E-S1 (test-plan-e2e §2): mẫu seed `hoa-don`
// chép cho acme (Kế toán = {B, T}). A gửi "!hoa-don HD-12 12.000.000" ở R ⇒ khối; T (ngoài phòng) Đạt trong DM "Quy trình" ⇒
// thread có tin kết quả task của T ("ngoài phòng"), khối A "Xong"; trang run 2 stage xong, Token khớp Σ usage_logs.
import { expect, test } from "@playwright/test";
import {
  block,
  copyTemplate,
  flowPane,
  mkRoom,
  PA_E2E,
  passBtn,
  settle,
  startUi,
  taskResult,
  usageSum,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

test('SC-2 · AC-H31 · E-S1 · "!hoa-don HD-12 12.000.000" ⇒ T Đạt trong DM ⇒ thread có "Thomas · Đạt" (ngoài phòng), khối "Xong"; trang run 2 giai đoạn xong, Token = Σ', async ({
  browser,
}) => {
  await copyTemplate("hoa-don", [PA_E2E.gKeToan]);
  const room = await mkRoom("ES1");
  const u = await users(browser, "A", "T");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!hoa-don HD-12 12.000.000");
    const blk = block(u.A, "Xử lý hoá đơn");
    await expect(blk).toBeVisible();

    await u.T.getByRole("link", { name: "Quy trình", exact: true }).click();
    const card = u.T.getByRole("log", { name: "Thông báo quy trình" })
      .getByRole("article", { name: /^Cần bạn kiểm: / })
      .last();
    await passBtn(card.getByRole("region", { name: /^Kiểm / })).click();
    await expect(card.getByText(/Bạn · Đạt/i)).toBeVisible();

    await expect(blk).toContainText("Hoàn tất", { timeout: 30_000 });
    await blk.getByRole("button", { name: "Trả lời tiếp" }).click();
    const res = taskResult(flowPane(u.A), "Thomas", "Đạt");
    await expect(res).toContainText("ngoài phòng");
    await expect(flowPane(u.A).getByText("Lượt chạy hoàn tất")).toBeVisible();

    await u.A.goto(`/runs/${runId}?tab=token`);
    const table = u.A.getByRole("table", { name: "Token theo giai đoạn" });
    await expect(table).toBeVisible();
    const sum = await usageSum(runId);
    expect(sum).toBeGreaterThan(0);
    await expect(u.A.getByTestId("process-total-tokens")).toContainText(
      sum.toLocaleString("vi-VN"),
    );
  } finally {
    await u.close();
  }
});

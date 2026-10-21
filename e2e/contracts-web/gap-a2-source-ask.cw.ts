// gap-a2 #3 · #6 · Luật 4b: trang HĐ — "Xem đoạn này trong văn bản gốc" mở khoang văn bản gốc và tô sáng đúng đoạn trích;
// "Hỏi về hợp đồng này" gửi câu hỏi tới trợ lý dùng chung kèm ngữ cảnh HĐ. Backend giả `page.route`; chờ phần tử/yêu cầu, không sleep.
// KHÔNG chạy trong lát (e2e chạy một lần cuối đợt).
import { expect, test } from "@playwright/test";
import { REVIEW_ID, reviewContract } from "./dataset-v2g";
import { installV2g } from "./v2g-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const SOURCE =
  "# Điều 1\nBên A giao hàng.\n\nGiao hàng đợt 1 trước ngày 01/03/2026 tại kho bên B.\n\n# Điều 2\nThanh toán 50% giá trị hợp đồng.";

test("trích dẫn mốc AI ⇒ mở văn bản gốc, tô sáng đúng đoạn", async ({ page }) => {
  await installV2g(page);
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...reviewContract({ status: "needs_review", version: 3 }),
        has_source: true,
      }),
    }),
  );
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}/source`, (r) =>
    r.fulfill({ status: 200, contentType: "text/markdown; charset=utf-8", body: SOURCE }),
  );
  await page.goto(`/contracts/${REVIEW_ID}`);
  const list = page.getByTestId("ai-milestones");
  await list.getByRole("button", { name: "Xem đoạn này trong văn bản gốc" }).first().click();
  await expect(page.getByTestId("source-panel")).toBeVisible();
  await expect(page.getByTestId("source-hit")).toHaveText("Giao hàng đợt 1 trước ngày 01/03/2026");
});

test("Hỏi về hợp đồng này ⇒ POST tin tới @assistant kèm ngữ cảnh HĐ", async ({ page }) => {
  await installV2g(page);
  const sent: unknown[] = [];
  await page.route("**/chat/conversations**", (r) => {
    const q = r.request();
    if (q.method() === "POST") {
      const b = q.postDataJSON() as { content?: string };
      if (b.content) {
        sent.push(b);
        return r.fulfill({ status: 202, contentType: "application/json", body: "{}" });
      }
      return r.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "00000000-0000-4000-8000-0000000000c1", title: "x" }),
      });
    }
    return r.fallback();
  });
  await page.goto(`/contracts/${REVIEW_ID}`);
  const box = page.getByTestId("ask-contract").getByRole("textbox");
  await box.fill("Phạt chậm giao hàng thế nào?");
  await box.press("Enter");
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const body = sent[0] as { content: string; context: { entity: { kind: string; id: string } } };
  expect(body.content.startsWith("@assistant ")).toBe(true);
  expect(body.content).toContain("Phạt chậm giao hàng thế nào?");
  expect(body.context.entity).toEqual({ kind: "contract", id: REVIEW_ID });
});

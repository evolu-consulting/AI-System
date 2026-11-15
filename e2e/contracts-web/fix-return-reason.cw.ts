// fix-return-reason · băng đầu trang HĐ (head-banner) hiện LÝ DO của bước quyết khi Trả lại / Từ chối, nội bộ và từ đối tác; người làm: nội bộ = tên
// người, đối tác = tên công ty đối tác (không lộ người bên kia). Backend giả `page.route`; không sleep. Viết, chưa chạy (điều phối chạy cuối đợt).
// Ca thật hai-công-ty nằm ở flows3 FL3-5a/5b/5c (nhánh e2e-tenant-flows) — chạy lại sau khi gộp.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const T = "2026-11-15T14:07:00.000Z";
const ev = (id: number, type: string, data: Record<string, unknown>, by: string | null) => ({
  id,
  type,
  at: T,
  actor_user_id: by,
  data,
});
const draftReturned = (over: Record<string, unknown>) => ({
  ...activeContract(),
  status: "draft",
  effect: null,
  extract_state: "ready",
  error: null,
  submit_round: 1,
  milestones: [],
  ...over,
});
const approvalNone = (page: import("@playwright/test").Page) =>
  page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/approval`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: null,
        run_status: null,
        step: null,
        task_id: null,
        can_act: false,
        feedback: null,
      }),
    }),
  );

test("Trưởng phòng Trả lại (ý kiến đi theo bằng chứng) ⇒ băng hiện lý do hub đưa sẵn", async ({
  page,
}) => {
  await installV2f(page, {
    contract: () =>
      draftReturned({
        return_reason: "Điều 3 thiếu hạn thanh toán, xin bổ sung",
        events: [ev(1, "stage_decided", { action: "return" }, "u1"), ev(2, "returned", {}, "u1")],
      }),
  });
  await approvalNone(page);
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const b = page.getByTestId("head-banner");
  await expect(b).toHaveAttribute("data-kind", "returned");
  await expect(b).toContainText("Điều 3 thiếu hạn thanh toán, xin bổ sung");
});

test("Trưởng phòng Từ chối ⇒ băng hiện lý do", async ({ page }) => {
  await installV2f(page, {
    contract: () =>
      draftReturned({
        status: "reject",
        return_reason: "Không phù hợp chính sách mua hàng",
        events: [ev(1, "stage_decided", { action: "reject" }, "u1"), ev(2, "rejected", {}, "u1")],
      }),
  });
  await approvalNone(page);
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const b = page.getByTestId("head-banner");
  await expect(b).toHaveAttribute("data-kind", "rejected");
  await expect(b).toContainText("Không phù hợp chính sách mua hàng");
});

test("Đối tác Trả lại ⇒ băng hiện tên công ty đối tác + lý do đối tác nêu, không «người khác»", async ({
  page,
}) => {
  await installV2f(page, {
    contract: () =>
      draftReturned({
        events: [
          ev(1, "partner_sent", { round: 1, to: "Công ty Đối Tác E" }, "u1"),
          ev(
            2,
            "partner_replied",
            { round: 1, outcome: "returned", reason: "Giá trị chưa khớp báo giá, xin sửa" },
            null,
          ),
          ev(3, "returned", {}, "99999999-9999-4999-8999-999999999999"),
        ],
      }),
  });
  await approvalNone(page);
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const b = page.getByTestId("head-banner");
  await expect(b).toContainText("Công ty Đối Tác E trả lại");
  await expect(b).toContainText("Giá trị chưa khớp báo giá, xin sửa");
  await expect(b).not.toContainText("người khác");
});

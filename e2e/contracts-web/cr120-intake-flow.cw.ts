// CR-120 · cr120-contracts-flow · khe `contracts.intake` trên UI contracts-web (backend giả `page.route`; chờ phần tử, không sleep):
//  (1) màn xác nhận (tenant tắt duyệt) có gợi ý ngay cạnh "Lưu nháp": bản nháp chỉ bạn thấy;
//  (2) "Gửi duyệt" ở thẻ duyệt engine ⇒ POST approve (qua route flow) đúng MỘT lần (không có bước "Gửi duyệt" tay) và hiện "Đã chuyển: <bước kế>";
//  (3) HĐ nháp / không quyền xem (hub 404 "Not found") ⇒ MỘT câu chung, không lộ HĐ có tồn tại.
// VIẾT, CHƯA CHẠY trong lát (e2e chạy một lần ở cuối bằng evotest).
import type { ApprovalCardStep, ContractApproval } from "@ai/contracts/pack-contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";
import { REVIEW_ID } from "./dataset-v2g";
import { mockApprovalFlow } from "./flow-mock";
import { installV2g } from "./v2g-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const step = (idx: number, name: string, status: ApprovalCardStep["status"]): ApprovalCardStep => ({
  idx,
  key: `s${idx}`,
  name,
  kind: "review",
  status,
  group_id: null,
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
});
const engineCard = (
  steps: ApprovalCardStep[],
  o: Partial<ContractApproval> = {},
): ContractApproval =>
  ({
    ...approvalAsHub("level1", { finalizes_on_approve: false }),
    mode: "engine",
    steps,
    ...o,
  }) as ContractApproval;

const UNSEEN = "d0000000-0000-4000-8000-0000000000aa";

test("màn xác nhận (tenant tắt duyệt): gợi ý 'Bản nháp chỉ bạn thấy' ngay cạnh Lưu nháp", async ({
  page,
}) => {
  await installV2g(page);
  await page.goto(`/contracts/c/${REVIEW_ID}`);
  await expect(page.getByRole("button", { name: "Lưu nháp" })).toBeVisible();
  await expect(page.getByTestId("draft-hint")).toHaveText(
    "Bản nháp chỉ bạn thấy — bấm Gửi duyệt để chuyển cho người duyệt",
  );
});

test("Gửi duyệt (engine) ⇒ approve MỘT lần, hiện 'Đã chuyển: <bước kế>'", async ({ page }) => {
  const d = asHub("editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  let state = engineCard([step(0, "Gửi duyệt", "open"), step(1, "Phòng Kế toán duyệt", "pending")]);
  const posts: unknown[] = [];
  // CR-120/121: hành động đi route flow (một đường duy nhất); thẻ đọc lại qua GET `/approval`.
  await mockApprovalFlow(page, {
    card: () => state,
    onAct: (body) => {
      posts.push(body);
      state = engineCard([step(0, "Gửi duyệt", "passed"), step(1, "Phòng Kế toán duyệt", "open")], {
        can_act: false,
      });
      return state;
    },
  });
  await page.route("**/pack/contracts/contracts/**", (r) =>
    new URL(r.request().url()).pathname.endsWith("/approval")
      ? json(r, 200, state)
      : json(r, 200, contractAsHub()),
  );
  await page.goto(`/contracts/c/${contract.id}`);
  await expect(page.getByTestId("moved-to")).toHaveCount(0);
  await page.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(page.getByTestId("moved-to")).toHaveText("Đã chuyển: Phòng Kế toán duyệt");
  expect(posts).toEqual([{ action: "approve" }]); // một lần; không có lệnh "gửi duyệt" nào khác
});

test("HĐ nháp / không quyền xem: một câu chung, không 'Not found' thô", async ({ page }) => {
  const d = asHub("editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(`**/pack/contracts/contracts/${UNSEEN}**`, (r) =>
    json(r, 404, { error: { code: "NOT_FOUND", message: "Not found" } }),
  );
  await page.goto(`/contracts/c/${UNSEEN}`);
  const box = page.getByTestId("contract-not-visible");
  await expect(box).toHaveText(
    "Hợp đồng chưa được gửi duyệt hoặc bạn không có quyền xem. Hãy nhờ người tạo xác nhận.",
  );
  await expect(page.getByText("Not found")).toHaveCount(0);
});

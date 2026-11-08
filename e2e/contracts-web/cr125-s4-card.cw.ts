// CR-125 · UX-S4/S8 · thẻ hợp đồng theo vai trên UI contracts-web (backend giả `page.route`; chờ phần tử, không sleep):
//  (1) người duyệt (bước duyệt đang mở, quyền quyết) thấy THẺ TÓM TẮT, form sửa gập trong "Xem và sửa chi tiết hợp đồng" (mở được);
//  (2) sau khi gửi duyệt, bước kế có hạn ⇒ "Đã gửi <bước> · hạn N giờ";
//  (3) bước hệ thống (Thông báo) không hiện cho người dùng thường.
import type { ApprovalCardStep, ContractApproval } from "@ai/contracts/pack-contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";
import { mockApprovalFlow } from "./flow-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const step = (
  idx: number,
  name: string,
  status: ApprovalCardStep["status"],
  o: Partial<ApprovalCardStep> = {},
): ApprovalCardStep => ({
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
  ...o,
});
const engineCard = (steps: ApprovalCardStep[], o: Partial<ContractApproval> = {}) =>
  ({
    ...approvalAsHub("level1", { finalizes_on_approve: false }),
    mode: "engine",
    steps,
    ...o,
  }) as ContractApproval;

async function open(
  page: Page,
  state: () => ContractApproval,
  o: { onAct?: () => ContractApproval; status?: string } = {},
) {
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
  await mockApprovalFlow(page, { card: state, ...(o.onAct ? { onAct: o.onAct } : {}) });
  await page.route("**/pack/contracts/contracts/**", (r) =>
    new URL(r.request().url()).pathname.endsWith("/approval")
      ? json(r, 200, state())
      : json(r, 200, o.status ? contractAsHub(o.status as never) : contractAsHub()),
  );
  await page.goto(`/contracts/c/${contract.id}`);
}

test("người duyệt thấy thẻ tóm tắt, form sửa gập lại", async ({ page }) => {
  const s = engineCard(
    [step(0, "Trưởng phòng duyệt", "passed"), step(1, "Giám đốc duyệt", "open")],
    { can_act: true },
  );
  await open(page, () => s, { status: "active" });
  await expect(page.getByTestId("summary")).toBeVisible();
  const fold = page.getByTestId("detail-fold");
  await expect(fold).toBeVisible();
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(fold.getByTestId("owner-row")).toBeHidden();
  await fold.locator("summary").click();
  await expect(fold.getByTestId("owner-row")).toBeVisible();
  // chỉ MỘT khối tóm tắt (thẻ trên cùng), không lặp trong lưới bên dưới
  await expect(page.getByTestId("summary")).toHaveCount(1);
});

test("gửi duyệt ⇒ 'Đã gửi <bước> · hạn N giờ'; bước hệ thống không hiện cho người thường", async ({
  page,
}) => {
  let state = engineCard([step(0, "Gửi duyệt", "open"), step(1, "Phòng Kế toán duyệt", "pending")]);
  const due = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const notify = (st: ApprovalCardStep["status"]) =>
    step(2, "Thông báo người tạo", st, { kind: "notify" });
  state = engineCard([...(state.steps ?? []), notify("pending")]);
  await open(page, () => state, {
    onAct: () => {
      state = engineCard(
        [
          step(0, "Gửi duyệt", "passed"),
          step(1, "Phòng Kế toán duyệt", "open", { due_at: due }),
          notify("pending"),
        ],
        { can_act: false },
      );
      return state;
    },
  });
  await expect(page.getByTestId("approval-step-2")).toHaveCount(0);
  await page.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(page.getByTestId("moved-to")).toHaveText(
    /^Đã gửi Phòng Kế toán duyệt · hạn (23|24) giờ$/,
  );
});

// Ảnh sau (desktop 1440 + điện thoại 390) cho docs/specs/cr125-ux-s4-contract-card/ — chỉ chạy khi đặt CR125_SHOTS=<thư mục>.
const SHOTS = process.env.CR125_SHOTS;
for (const [tag, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const)
  test(`ảnh · thẻ người duyệt ${tag}`, async ({ page }) => {
    test.skip(!SHOTS, "chỉ chụp khi CR125_SHOTS");
    await page.setViewportSize(size);
    const s = engineCard(
      [step(0, "Trưởng phòng duyệt", "passed"), step(1, "Giám đốc duyệt", "open")],
      { can_act: true },
    );
    await open(page, () => s, { status: "active" });
    await expect(page.getByTestId("detail-fold")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/after-approver-card-${tag}.png`, fullPage: false });
  });

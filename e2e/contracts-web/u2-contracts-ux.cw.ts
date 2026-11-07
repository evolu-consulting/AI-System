// CR-123 U2 (FLOW3-FR-11, FLOW3-FR-13 phần C) · Luật 4b + Luật GỐC 3/4: hành trình xem thẻ duyệt theo ba dòng (trạng thái · lý do · bước kế),
// người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối, cảnh báo "bước Thông báo không có người nhận" cho chủ HĐ, và Cài đặt › Ứng dụng &
// quy trình CHỈ ĐỌC (một nơi chọn quy trình = admin Công ty › Quy trình). Chụp ảnh các trạng thái vào docs/specs/CR-123/shots/u2-*.
// Backend giả `page.route`; chờ phần tử, không sleep.
import { mkdirSync } from "node:fs";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { flowViewOfCard } from "../../apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules";
import { asHub, type Role } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";
import { mockApprovalFlow } from "./flow-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const SHOTS = process.env.U2_SHOTS ?? "docs/specs/CR-123/shots";
const shot = async (el: Locator, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await el.screenshot({ path: `${SHOTS}/u2-${name}.png` });
};

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const GROUPS = [
  { id: G1, name: "Kinh doanh" },
  { id: G2, name: "Kế toán" },
];
type Step = NonNullable<ContractApproval["steps"]>[number];
const step = (idx: number, name: string, status: Step["status"], o: Partial<Step> = {}): Step => ({
  idx,
  key: `s${idx}`,
  name,
  kind: "review",
  status,
  group_id: idx === 0 ? G1 : G2,
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  ...o,
});
const card = (steps: Step[], o: Partial<ContractApproval> = {}): ContractApproval => ({
  mode: "engine",
  run_id: G1,
  run_status: "running",
  step: "level1",
  task_id: TASK,
  can_act: true,
  feedback: null,
  finalizes_on_approve: false,
  steps,
  ...o,
});
const SOAN = step(0, "Soạn & kiểm tra", "passed", {
  decided_by: { id: G1, name: "Lan" },
  decided_at: "2026-11-08T02:00:00.000Z",
});

async function install(page: Page, state: ContractApproval, role: Role = "editor") {
  const d = asHub(role);
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
  await page.route("**/pack/contracts/groups", (r) => json(r, 200, GROUPS));
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return json(r, 200, path.endsWith("/approval") ? state : contractAsHub());
  });
  await mockApprovalFlow(page, { card: () => state });
}

async function timeline(page: Page) {
  await page.goto(`/contracts/c/${contract.id}`);
  const tl = page.locator("[data-approval=timeline]");
  await expect(tl).toBeVisible();
  return tl;
}

test("người duyệt: bước đang chờ 3 dòng, chỉ Duyệt · Trả lại sửa · Từ chối", async ({ page }) => {
  await install(
    page,
    card([SOAN, step(1, "Kế toán duyệt", "open", { due_at: "2026-11-09T02:00:00.000Z" })]),
  );
  const tl = await timeline(page);
  const s1 = tl.getByTestId("approval-step-1");
  await expect(s1.locator("[data-approval=status-lines] p")).toHaveCount(3);
  await expect(s1).toContainText("Đang chờ Kế toán duyệt");
  await expect(s1).toContainText("Hạn");
  await expect(s1).toContainText("Bạn cần: Duyệt, Trả lại sửa hoặc Từ chối");
  await expect(tl.getByTestId("approval-step-0")).toContainText("Đã duyệt");
  await expect(tl.getByTestId("approval-step-0")).toContainText("Bởi Lan");
  await expect(page.locator("[data-approval=pass]")).toHaveText("Duyệt");
  await expect(page.locator("[data-approval=return]")).toHaveText("Trả lại sửa");
  await expect(page.locator("[data-approval=reject]")).toHaveText("Từ chối");
  await expect(page.getByRole("button", { name: "Đạt", exact: true })).toHaveCount(0);
  await shot(tl, "card-open-approver");
  // Từ chối bắt buộc lý do
  await page.locator("[data-approval=reject]").click();
  await page.locator("[data-approval=reason] button[type=submit]").click();
  await expect(page.getByRole("alert")).toContainText("Vui lòng nhập lý do");
});

test("người không phải người duyệt: thấy ai đang chờ, không có nút", async ({ page }) => {
  await install(
    page,
    card([SOAN, step(1, "Kế toán duyệt", "open")], {
      can_act: false,
      block_reason: "not_reviewer",
    }),
  );
  const tl = await timeline(page);
  await expect(tl.getByTestId("approval-step-1")).toContainText("Chờ Kế toán; bạn chưa cần làm gì");
  await expect(page.locator("[data-approval=pass]")).toHaveCount(0);
  await shot(tl, "card-open-other");
});

test("trả lại và từ chối nói lý do và bước kế", async ({ page }) => {
  await install(
    page,
    card(
      [
        SOAN,
        step(1, "Kế toán duyệt", "returned", { feedback: "Sửa lại giá trị hợp đồng" }),
        step(2, "Giám đốc duyệt", "pending"),
      ],
      { step: "level1", can_act: false },
    ),
  );
  const tl = await timeline(page);
  await expect(tl.getByTestId("approval-step-1")).toContainText("Đã trả lại sửa");
  await expect(tl.getByTestId("approval-step-1")).toContainText("Sửa lại giá trị hợp đồng");
  await expect(tl.getByTestId("approval-step-1")).toContainText("Người soạn sửa rồi gửi duyệt lại");
  await expect(tl.getByTestId("approval-step-2")).toContainText("Chưa tới lượt");
  await shot(tl, "card-returned-pending");
});

test("ký số cần xử lý: lý do kèm cách sửa, không còn 'Cần quyết'", async ({ page }) => {
  await install(
    page,
    card([SOAN], {
      step: "done",
      can_act: false,
      esign: {
        key: "esign",
        name: "Ký số hợp đồng",
        status: "needs_decision",
        reason: "NO_PARTNER_EMAIL",
        can_resend: true,
      },
    }),
  );
  const tl = await timeline(page);
  const es = tl.getByTestId("approval-step-esign");
  await expect(es).toContainText("Cần xử lý");
  await expect(es).toContainText("Thêm email ở thông tin đối tác rồi bấm Gửi lại");
  await expect(es.locator("[data-approval=esign-resend]")).toBeVisible();
  await expect(tl).not.toContainText("Cần quyết");
  await shot(tl, "card-esign-needs-action");
});

test("chủ HĐ thấy cảnh báo bước Thông báo không có người nhận", async ({ page }) => {
  const state = card([SOAN, step(1, "Báo giám đốc", "passed")], { step: "level1", can_act: false });
  await install(page, state, "owner");
  // Hub phát cờ `warning` ở bước Thông báo (FlowView); giả bằng cách vá bản chiếu.
  await page.route("**/pack/contracts/flow/contracts.approval/*", (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const view = flowViewOfCard(state, contract.id, null);
    const steps = view.steps.map((s) =>
      s.name === "Báo giám đốc" ? { ...s, warning: "NOTIFY_NO_RECIPIENT" } : s,
    );
    return json(r, 200, { ...view, steps });
  });
  const tl = await timeline(page);
  await expect(tl.locator("[data-approval=notify-no-recipient]")).toHaveText(
    "Không có ai nhận thông báo bước Báo giám đốc — chọn người nhận trong Công ty › Quy trình",
  );
  await shot(tl, "card-notify-no-recipient");
});

// ---- Cài đặt › Ứng dụng & quy trình: chỉ đọc ----
const TENANT = "c1000000-0000-4000-8000-000000000001";
const DEF = "44444444-4444-4444-8444-444444444444";
const caps = {
  tenant_id: TENANT,
  versions: { admin: 1, hub: 1 },
  apps: [
    {
      key: "contracts",
      level: "write",
      addons: [],
      slots: [
        {
          slot: "contracts.approval",
          def_id: DEF,
          def_name: "Duyệt hợp đồng",
          version: 2,
          is_default: false,
        },
      ],
      agents: [],
      tools: [],
    },
  ],
  shared: { agents: [], dify_workflows: [], tools: [] },
};

async function openApps(
  page: Page,
  processes: { def_id: string; name: string; rel_version: number | null }[],
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) =>
    json(r, 200, { ...d.grant, user: { ...d.grant.user, role: "tenant_admin" } }),
  );
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/hub-admin/tenants/*/capabilities", (r) => json(r, 200, caps));
  const writes: string[] = [];
  await page.route("**/tenants/*/process-routing/**", (r) => {
    if (r.request().method() !== "GET") writes.push(r.request().method());
    const cur = processes[0];
    return json(r, 200, {
      slot: "contracts.approval",
      version: 0,
      rules: [],
      processes,
      current_def_id: cur?.def_id ?? null,
      current_def_name: cur?.name ?? null,
      active: true,
    });
  });
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Ứng dụng & quy trình/ }).click();
  return { dlg, writes };
}

test("Cài đặt › Ứng dụng & quy trình: chỉ đọc, một nút Mở trang Quy trình", async ({ page }) => {
  const { dlg, writes } = await openApps(page, [
    { def_id: DEF, name: "Duyệt hợp đồng", rel_version: 2 },
  ]);
  const pane = dlg.getByTestId("apps-pane");
  await expect(pane.locator('[data-testid^="apps-slot-contracts"]').first()).toContainText(
    "Đang áp dụng: Duyệt hợp đồng",
  );
  await expect(pane.getByTestId("apps-all-flows")).toHaveText("Mở trang Quy trình");
  for (const gone of ["Thêm luật", "Lưu luật", "Luật chọn quy trình"])
    await expect(pane.getByText(gone)).toHaveCount(0);
  expect(writes).toEqual([]); // không còn đường ghi từ ứng dụng
  await shot(dlg, "settings-apps");
});

test("Cài đặt › Ứng dụng & quy trình: chưa có quy trình ⇒ nói rõ ai làm gì ở đâu", async ({
  page,
}) => {
  const { dlg } = await openApps(page, []);
  await expect(dlg.getByTestId("slot-none-assigned")).toHaveText(
    "Hợp đồng chưa có quy trình duyệt — quản trị công ty chọn tại Công ty › Quy trình",
  );
  await shot(dlg, "settings-apps-none");
});

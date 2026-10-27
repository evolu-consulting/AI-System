// esign-flow · Cài đặt › Quy trình duyệt: thêm bước "Ký số" (cuối luồng, một lần), chọn người ký cụ thể + đối tác ký trước, chọn
// người duyệt cụ thể ở bước duyệt, Lưu gửi PUT đúng hình dạng; lỗi server USER_NOT_MEMBER hiện theo trường. Backend giả `page.route`.
// esign-sweep2 · thẻ duyệt: bước Ký số đã gửi hiện "Hạn ký", nhãn "Quá hạn" và "Đã nhắc lúc" (VIẾT, CHƯA CHẠY — e2e chạy cuối đợt).
import type { ContractApproval } from "@ai/contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const D1 = "11111111-1111-4111-8111-111111111111";
const U1 = "33333333-3333-4333-8333-333333333333";
const FLOW = {
  version: 3,
  is_default: false,
  updated_at: "2026-10-27T00:00:00.000Z",
  steps: [
    {
      kind: "review",
      key: "s0",
      name: "Soạn & kiểm tra",
      department_group_id: D1,
      head_only: false,
      due_h: 72,
      remind_every_h: null,
      escalate_group_id: null,
      exclude_starter: false,
      when: null,
    },
  ],
};

async function install(page: Page, put: "ok" | "member" = "ok") {
  const d = asHub("owner");
  const puts: { version: number; steps: Record<string, unknown>[] }[] = [];
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const grant = { ...d.grant, user: { ...d.grant.user, role: "tenant_admin" } };
  await page.route("**/auth/refresh", (r) => json(r, 200, grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/groups", (r) =>
    json(r, 200, [{ id: D1, name: "Kinh doanh" }]),
  );
  await page.route("**/pack/contracts/dify-workflows", (r) => json(r, 200, { items: [] }));
  await page.route("**/pack/contracts/assignees", (r) =>
    json(r, 200, { items: [{ id: U1, name: "Chị Hoa" }] }),
  );
  await page.route("**/pack/contracts/esign/settings", (r) =>
    json(r, 200, {
      configured: true,
      enabled: true,
      provider: "docusign",
      demo: false,
      providers: [
        { key: "docusign", label: "DocuSign", kind: "envelope", available: true, legal: true },
      ],
      default_provider: "docusign",
    }),
  );
  await page.route("**/pack/contracts/approval-flow", (r) => {
    if (r.request().method() !== "PUT") return json(r, 200, FLOW);
    const body = r.request().postDataJSON();
    puts.push(body);
    if (put === "member")
      return json(r, 422, {
        error: {
          code: "APPROVAL_FLOW_INVALID",
          message: "bad",
          details: {
            issues: [{ path: "steps.1.company_signer.user_id", rule: "USER_NOT_MEMBER" }],
          },
        },
      });
    return json(r, 200, { ...FLOW, version: 4, steps: body.steps });
  });
  return puts;
}

async function open(page: Page) {
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  return dlg;
}

test("owner: thêm bước Ký số (cuối, một lần), người ký cụ thể, đối tác ký trước; người duyệt cụ thể; Lưu gửi PUT", async ({
  page,
}) => {
  const puts = await install(page);
  const dlg = await open(page);
  await dlg.getByRole("button", { name: "Thêm bước Ký số" }).click();
  await expect(dlg.getByRole("button", { name: "Thêm bước Ký số" })).toHaveCount(0);
  const sign = dlg.getByTestId("flow-step-1");
  await expect(sign.getByTestId("flow-esign-fields")).toBeVisible();
  await sign.getByLabel("Người ký phía công ty").selectOption("user");
  await sign.getByLabel("Người ký", { exact: true }).selectOption(U1);
  await sign.getByLabel("Thứ tự ký").selectOption("partner_first");
  // bước duyệt mới chèn TRƯỚC bước Ký số
  await dlg.getByRole("button", { name: "Thêm bước duyệt" }).click();
  const rv = dlg.getByTestId("flow-step-1");
  await rv.getByLabel("Tên bước").fill("Giám đốc");
  await rv.getByLabel("Người duyệt cụ thể").selectOption(U1);
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect.poll(() => puts.length).toBe(1);
  const steps = puts[0]?.steps ?? [];
  expect(steps.map((s) => s.kind)).toEqual(["review", "review", "esign"]);
  expect(steps[1]).toMatchObject({ approver_user_id: U1, department_group_id: null });
  expect(steps[2]).toMatchObject({
    company_signer: { mode: "user", user_id: U1 },
    partner_signs: true,
    order: "partner_first",
    provider: null,
  });
});

test("owner: server từ chối người ký không thuộc công ty ⇒ lỗi theo trường của bước Ký số", async ({
  page,
}) => {
  await install(page, "member");
  const dlg = await open(page);
  await dlg.getByRole("button", { name: "Thêm bước Ký số" }).click();
  const sign = dlg.getByTestId("flow-step-1");
  await sign.getByLabel("Người ký phía công ty").selectOption("user");
  await sign.getByLabel("Người ký", { exact: true }).selectOption(U1);
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect(
    sign.getByText("Người này không thuộc công ty hoặc không có quyền sửa hợp đồng."),
  ).toBeVisible();
});

const SIGN_CARD = (e: Partial<NonNullable<ContractApproval["esign"]>>): ContractApproval => ({
  mode: "engine",
  run_id: D1,
  run_status: "completed",
  step: "done",
  task_id: null,
  can_act: false,
  feedback: null,
  steps: [
    {
      idx: 0,
      key: "s0",
      name: "Soạn & kiểm tra",
      kind: "review",
      status: "passed",
      group_id: D1,
      head_only: false,
      escalated_group_id: null,
      due_at: null,
      escalated: false,
      decided_by: null,
      decided_at: null,
      feedback: null,
    },
  ],
  esign: {
    key: "sign",
    name: "Ký số hợp đồng",
    status: "sent",
    reason: null,
    can_resend: false,
    ...e,
  },
});

async function installCard(page: Page, state: ContractApproval) {
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
  await page.route("**/pack/contracts/groups", (r) => json(r, 200, []));
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/approval")) return json(r, 200, state);
    return json(r, 200, contractAsHub());
  });
}

test("thẻ duyệt: bước Ký số đã gửi quá hạn ⇒ Hạn ký + nhãn Quá hạn + Đã nhắc lúc", async ({
  page,
}) => {
  await installCard(
    page,
    SIGN_CARD({
      due_at: "2026-10-23T00:00:00.000Z",
      overdue: true,
      reminded_at: "2026-10-22T00:00:00.000Z",
    }),
  );
  await page.goto(`/contracts/${contract.id}`);
  const row = page.getByTestId("approval-step-esign");
  await expect(row).toHaveAttribute("data-status", "sent");
  await expect(row.locator("[data-esign=due-at]")).toContainText("Hạn ký:");
  await expect(row.locator("[data-esign=overdue]")).toHaveText("Quá hạn");
  await expect(row.locator("[data-esign=reminded-at]")).toContainText("Đã nhắc lúc");
});

test("thẻ duyệt: bước Ký số chưa quá hạn, chưa nhắc ⇒ chỉ Hạn ký", async ({ page }) => {
  await installCard(
    page,
    SIGN_CARD({ due_at: "2099-01-01T00:00:00.000Z", overdue: false, reminded_at: null }),
  );
  await page.goto(`/contracts/${contract.id}`);
  const row = page.getByTestId("approval-step-esign");
  await expect(row.locator("[data-esign=due-at]")).toBeVisible();
  await expect(row.locator("[data-esign=overdue]")).toHaveCount(0);
  await expect(row.locator("[data-esign=reminded-at]")).toHaveCount(0);
});

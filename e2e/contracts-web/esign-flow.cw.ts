// esign-flow · CR-105: Cài đặt › Quy trình duyệt chỉ ĐỌC quy trình thư viện đang dùng (có bước Ký số là nút đuôi); việc soạn
// bước Ký số/người ký chuyển sang admin-web (e2e/P-a/pf4/process-library.pa.ts). Backend giả `page.route`.
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
// CR-105: Cài đặt chỉ ĐỌC quy trình đang dùng (thư viện, gán cho tenant). Quy trình có bước Ký số là NÚT ĐUÔI.
const FLOW = {
  def_id: "44444444-4444-4444-8444-444444444444",
  name: "Duyệt & ký số HĐ",
  rel_version: 3,
  is_default: false,
  steps: [
    { name: "Soạn & kiểm tra", department_name: "Kinh doanh", kind: "review", when: null },
    { name: "Giám đốc", department_name: "Ban giám đốc", kind: "review", when: null },
    { name: "Ký số hợp đồng", department_name: null, kind: "esign", when: null },
  ],
};

async function install(page: Page) {
  const d = asHub("owner");
  const writes: string[] = [];
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
    if (r.request().method() !== "GET") writes.push(r.request().method());
    return json(r, 200, FLOW);
  });
  return writes;
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

test("quy trình đang dùng: duyệt qua các bước rồi Ký số ở cuối, chỉ xem (không thêm/sửa bước Ký số)", async ({
  page,
}) => {
  const writes = await install(page);
  const dlg = await open(page);
  const steps = dlg.getByTestId("flow-diagram").getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.last()).toContainText("Ký số hợp đồng");
  await expect(steps.first()).toContainText("Soạn & kiểm tra");
  await expect(dlg.getByRole("button", { name: /Thêm bước|Lưu quy trình/ })).toHaveCount(0);
  await expect(dlg.getByTestId("flow-esign-fields")).toHaveCount(0);
  expect(writes).toEqual([]);
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

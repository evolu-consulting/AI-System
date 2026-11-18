// CR-182 · Cài đặt › Quy trình duyệt: quản trị công ty bấm bước có vai ⇒ giao NHÓM ⇒ «Lưu giao việc» ⇒ node hết viền vàng, dòng dưới sơ đồ đổi;
// thành viên thường chỉ xem (không mở được khung, có câu «Chỉ quản trị công ty đổi được»). Backend giả `page.route` (PUT đổi trạng thái GET); không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { mockSignature } from "./signature-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNED = {
  kind: "group",
  id: GROUP_ID,
  name: "Ban giám đốc",
  members: [{ id: USER_ID, name: "Lê Thị Hoa" }],
};
const G = (
  key: string,
  step: number,
  name: string,
  kind: string,
  o: Record<string, unknown> = {},
) => ({
  key,
  step,
  name,
  kind,
  after: "review",
  back_to: [],
  branch: [],
  yes: null,
  no: null,
  next_step: null,
  terminal: false,
  ...o,
});
const ROLE = { key: "giam-doc", label: "Giám đốc" }; // khoá vai: chữ thường + gạch ngang (RoleKeySchema)
const flow = (assigned: unknown) => ({
  def_id: FLOW_ID,
  name: "Duyệt hợp đồng mua",
  rel_version: 2,
  steps: [{ name: "Giám đốc duyệt", department_name: null, kind: "review", approver_count: 1 }],
  graph: [
    G("s0", 0, "Giám đốc duyệt", "review", { role: ROLE, assigned }),
    G("s1", 1, "Đã duyệt", "end", { terminal: true }),
  ],
});

async function install(page: Page, tenantRole: string) {
  const d = asHub("owner");
  let assigned: unknown = null;
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) =>
    json(r, { ...d.grant, user: { ...d.grant.user, role: tenantRole } }),
  );
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  await page.route("**/pack/contracts/groups", (r) =>
    json(r, [{ id: GROUP_ID, name: "Ban giám đốc" }]),
  );
  await page.route("**/pack/contracts/dify-workflows", (r) => json(r, { items: [] }));
  await page.route(
    "**/pack/contracts/approval-flow",
    (r) => json(r, { items: [flow(assigned)], can_edit: tenantRole === "tenant_admin" }), // máy chủ quyết quyền giao việc (Q15), ở cấp danh sách,
  );
  await page.route("**/pack/contracts/groups/*/members*", (r) =>
    json(r, { items: ASSIGNED.members, next: null }),
  );
  await page.route("**/pack/contracts/approval-flow/roles", (r) => {
    const b = r.request().postDataJSON() as { role_key: string; group_id?: string | null };
    assigned = b.group_id ? ASSIGNED : null;
    return json(r, { flow_id: FLOW_ID, role_key: b.role_key, assigned });
  });
  await mockSignature(page);
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  return dlg;
}

test("CR-182 · quản trị giao nhóm cho vai ⇒ Lưu giao việc ⇒ node hết viền vàng", async ({
  page,
}) => {
  const dlg = await install(page, "tenant_admin");
  const node = dlg.getByTestId("def-node-stage").filter({ hasText: "Giám đốc duyệt" });
  await expect(node).toContainText("Vai · Giám đốc");
  await expect(node).toContainText("⚠ Chưa giao người");
  await expect(node).toHaveAttribute("data-unassigned", "1");
  await expect(dlg.getByTestId("assign-status")).toContainText("Còn 1 vai chưa giao người");
  await node.click();
  const panel = dlg.getByTestId("assign-panel");
  await expect(panel.getByTestId("assign-role")).toContainText("VAI · GIÁM ĐỐC");
  await expect(panel.getByTestId("assign-used-by")).toContainText("Giám đốc duyệt");
  await expect(panel.getByRole("button", { name: "Lưu giao việc" })).toBeDisabled();
  await panel.getByTestId("assign-group").click();
  await page.getByRole("option", { name: "Ban giám đốc" }).click();
  await panel.getByRole("button", { name: "Lưu giao việc" }).click();
  const ok = page.getByTestId("assign-confirm");
  await expect(ok).toContainText("Việc đang chờ vẫn giữ người cũ");
  await ok.getByRole("button", { name: "Lưu giao việc" }).click();
  await expect(page.getByText("Đã lưu giao việc")).toBeVisible();
  await expect(node).not.toHaveAttribute("data-unassigned", "1");
  await expect(node).toContainText("Ban giám đốc · 1 người");
  await expect(dlg.getByTestId("assign-status")).toContainText("Mọi bước đã có người làm.");
  await expect(dlg.getByTestId("assign-members")).toContainText("Lê Thị Hoa");
});

test("CR-182 · thành viên thường chỉ xem: bấm bước không mở khung, có câu «Chỉ quản trị công ty đổi được»", async ({
  page,
}) => {
  const dlg = await install(page, "member");
  const node = dlg.getByTestId("def-node-stage").filter({ hasText: "Giám đốc duyệt" });
  await expect(node).toContainText("⚠ Chưa giao người");
  await node.click({ force: true }); // người thường: nút không phản hồi (không mở khung)
  await expect(dlg.getByTestId("assign-panel")).toHaveCount(0);
  await expect(dlg.getByTestId("assign-hint")).toContainText("Chỉ quản trị công ty đổi được");
});

test("CR-182 · điện thoại 390px: khung giao việc là sheet, nút ≥ 44px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dlg = await install(page, "tenant_admin");
  await dlg.getByTestId("def-node-stage").filter({ hasText: "Giám đốc duyệt" }).click();
  const save = page.getByRole("dialog").getByRole("button", { name: "Lưu giao việc" });
  await expect(save).toBeVisible();
  expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

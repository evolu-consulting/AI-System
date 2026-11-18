// CR-184 · Cài đặt: (1) quy trình đổi bằng ô chọn; (2) sơ đồ có nhánh Đúng/Sai + bước Ký hiện «Ký trên tài liệu»;
// (3) «Kết nối» chỉ còn «Gửi và nhận hợp đồng với đối tác»; (4) «Vị trí ô ký» ẩn khi không có DocuSign. Backend giả `page.route`; không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { mockSignature } from "./signature-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

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
const FLOW_A = {
  def_id: "11111111-1111-4111-8111-111111111111",
  name: "Duyệt hợp đồng mua",
  rel_version: 2,
  steps: [
    { name: "Soạn & kiểm tra", department_name: "Kinh doanh", kind: "review", approver_count: 2 },
    { name: "Giám đốc duyệt", department_name: "Ban giám đốc", kind: "review", approver_count: 1 },
    { name: "Ký hợp đồng", department_name: null, kind: "esign" },
  ],
  graph: [
    G("s0", 0, "Soạn & kiểm tra", "review", { department_name: "Kinh doanh" }),
    G("s1", 1, "Giá trị lớn?", "if", { yes: 2, no: 3 }),
    G("s2", 2, "Giám đốc duyệt", "review", { department_name: "Ban giám đốc" }),
    G("s3", 3, "Ký hợp đồng", "esign", { provider: "ondoc" }),
    G("s4", 4, "Đã duyệt", "end", { terminal: true }),
  ],
};
const FLOW_B = {
  def_id: "22222222-2222-4222-8222-222222222222",
  name: "Duyệt hợp đồng bán",
  rel_version: 5,
  steps: [{ name: "Kế toán duyệt", department_name: "Kế toán", kind: "review", approver_count: 1 }],
  graph: [
    G("b0", 0, "Kế toán duyệt", "review", { department_name: "Kế toán" }),
    G("b1", 1, "Đã duyệt", "end", { terminal: true }),
  ],
};
const ENVELOPE = {
  key: "docusign",
  label: "DocuSign",
  kind: "envelope",
  available: true,
  legal: true,
};
const CA = { key: "selfsign", label: "Ký thử", kind: "ca", available: true, legal: false };

async function install(page: Page, providers: unknown[]) {
  const d = asHub("owner");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const grant = { ...d.grant, user: { ...d.grant.user, role: "tenant_admin" } };
  await page.route("**/auth/refresh", (r) => json(r, grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  await page.route("**/pack/contracts/groups", (r) => json(r, []));
  await page.route("**/pack/contracts/dify-workflows", (r) => json(r, { items: [] }));
  await page.route("**/pack/contracts/approval-flow", (r) => json(r, { items: [FLOW_A, FLOW_B] }));
  await page.route("**/pack/contracts/esign/settings", (r) =>
    json(r, {
      configured: true,
      enabled: true,
      provider: (providers[0] as { key: string }).key,
      default_provider: (providers[0] as { key: string }).key,
      demo: false,
      providers,
    }),
  );
  await page.route("**/pack/contracts/esign/anchors", (r) =>
    json(r, { a: ["BÊN A"], b: ["BÊN B"], is_default: true }),
  );
  await mockSignature(page);
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  return page.getByRole("dialog", { name: "Cài đặt" });
}

test("CR-184 · Quy trình duyệt: danh sách là ô chọn; đổi quy trình bằng ô chọn thì sơ đồ đổi theo", async ({
  page,
}) => {
  const dlg = await install(page, [ENVELOPE]);
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  const sel = dlg.getByTestId("flow-select");
  await expect(sel).toContainText("Duyệt hợp đồng mua");
  await expect(dlg.getByTestId("flow-list-items")).toHaveCount(0);
  await expect(dlg.getByTestId("flow-current-title")).toContainText("Duyệt hợp đồng mua");
  await sel.click();
  await expect(page.getByTestId("flow-option-1")).toContainText("Duyệt hợp đồng bán");
  await page.getByTestId("flow-option-1").click();
  await expect(dlg.getByTestId("flow-current-title")).toContainText("Duyệt hợp đồng bán");
  await expect(dlg.getByTestId("flow-canvas").getByText("Kế toán duyệt")).toBeVisible();
});

test("CR-184 · sơ đồ có nhánh Đúng/Sai, bước Ký hiện «Ký trên tài liệu» (không còn «Ký số»), Danh sách ghi Đúng ⇒ / Sai ⇒", async ({
  page,
}) => {
  const dlg = await install(page, [ENVELOPE]);
  await dlg.getByRole("button", { name: /Quy trình duyệt/ }).click();
  const cv = dlg.getByTestId("flow-canvas");
  await expect(cv.getByText("Bắt đầu", { exact: true })).toBeVisible();
  await expect(cv.getByText("Đúng", { exact: true })).toBeVisible();
  await expect(cv.getByText("Sai", { exact: true })).toBeVisible();
  await expect(cv.getByText("Ký trên tài liệu")).toBeVisible();
  await expect(cv.getByText("Ký số", { exact: true })).toHaveCount(0);
  await dlg.getByTestId("flow-view-list").click();
  const list = dlg.getByTestId("flow-diagram");
  await expect(list.getByTestId("flow-row-s1")).toContainText("Đúng ⇒ Giám đốc duyệt");
  await expect(list.getByTestId("flow-row-s1")).toContainText("Sai ⇒ Ký hợp đồng");
  await expect(list.getByTestId("flow-row-s3")).toContainText("Ký trên tài liệu");
});

test("CR-184 · Kết nối chỉ còn «Gửi và nhận hợp đồng với đối tác», Ký số nằm ở Chữ ký", async ({
  page,
}) => {
  const dlg = await install(page, [ENVELOPE]);
  await dlg.getByRole("button", { name: /^Kết nối/ }).click();
  await expect(dlg.getByTestId("sign-partner-pane")).toBeVisible();
  await expect(dlg.getByTestId("sign-block-partner")).toBeVisible();
  await expect(dlg.getByTestId("esign-enabled")).toHaveCount(0);
  await expect(dlg.getByTestId("esign-provider-setting")).toHaveCount(0);
  await expect(dlg.getByTestId("esign-anchor-setting")).toHaveCount(0);
  await dlg.getByRole("button", { name: /^Chữ ký/ }).click();
  await expect(dlg.getByTestId("sig-provider")).toBeVisible();
  await expect(dlg.getByTestId("esign-enabled")).toBeVisible();
});

test("CR-184 · «Vị trí ô ký» chỉ hiện khi có DocuSign; chỉ có Ký thử thì ẩn", async ({ page }) => {
  const dlg = await install(page, [CA]);
  await dlg.getByRole("button", { name: /^Chữ ký/ }).click();
  await expect(dlg.getByTestId("sig-provider")).toBeVisible();
  await expect(dlg.getByTestId("esign-anchor-setting")).toHaveCount(0);
});

test("CR-184 · «Vị trí ô ký» hiện khi có DocuSign đang bật", async ({ page }) => {
  const dlg = await install(page, [ENVELOPE, CA]);
  await dlg.getByRole("button", { name: /^Chữ ký/ }).click();
  await expect(dlg.getByTestId("esign-anchor-setting")).toBeVisible();
});

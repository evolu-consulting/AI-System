// CR-118 §11.2 · cr118-tenant-settings · Cài đặt › "Ứng dụng & quy trình": tenant admin thêm luật chọn quy trình theo phòng ban ⇒ người phòng
// đó khởi tạo đúng quy trình. Backend giả `page.route` có trạng thái (luật lưu ở PUT ⇒ GET/approval-flow của người phòng đó trả quy trình khớp);
// việc CHỌN quy trình thật khi launch (pickProcess + run snapshot) phủ ở int hub `routing-launch.int.test.ts`. VIẾT, CHƯA CHẠY (e2e chạy cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const P_DEFAULT = "11111111-1111-4111-8111-111111111111";
const P_SALES = "22222222-2222-4222-8222-222222222222";
const D_SALES = "33333333-3333-4333-8333-333333333333";
const D_LEGAL = "44444444-4444-4444-8444-444444444444";
const SLOT = "contracts.approval";

type Rule = {
  id: string;
  priority: number;
  condition: { departmentIds?: string[]; contractKinds?: string[] };
  def_id: string;
  is_default: boolean;
};

async function install(page: Page, role: "tenant_admin" | "member") {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = asHub("owner");
  const tid = d.grant.user.tenant.id;
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) =>
    json(r, 200, { ...d.grant, user: { ...d.grant.user, role } }),
  );
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/esign/settings", (r) =>
    json(r, 200, { configured: false, enabled: false, provider: null, demo: false, providers: [] }),
  );
  await page.route("**/pack/contracts/approval-flow", (r) =>
    json(r, 200, {
      def_id: P_DEFAULT,
      name: "Mặc định",
      rel_version: 1,
      is_default: true,
      steps: [],
    }),
  );
  await page.route("**/admin/org", (r) =>
    json(r, 200, {
      members: [],
      departments: [
        { group_id: D_SALES, key: "sales", name: "Kinh doanh", head_user_id: null, member_ids: [] },
        { group_id: D_LEGAL, key: "legal", name: "Pháp chế", head_user_id: null, member_ids: [] },
      ],
    }),
  );
  await page.route(`**/hub-admin/tenants/${tid}/capabilities`, (r) =>
    json(r, 200, {
      tenant_id: tid,
      versions: { hub: 1, admin: 1 },
      apps: [
        {
          key: "contracts",
          level: "write",
          addons: [{ key: "han-muc-duyet", on: true }],
          slots: [
            { slot: SLOT, def_id: P_DEFAULT, def_name: "Mặc định", version: 1, is_default: true },
          ],
          agents: [],
          tools: [],
        },
      ],
      shared: { agents: [], dify_workflows: [], standalone_flows: [], default_model: null },
      limits: { uploads_day: null, actions_day: null, ai_tokens_day: null },
    }),
  );
  // Trạng thái luật của tenant × khe (PUT thay cả danh sách; `version` lệch ⇒ 409).
  const st = { version: 0, rules: [] as Rule[], puts: [] as unknown[], conflictNext: false };
  const processes = [
    { def_id: P_DEFAULT, name: "Mặc định", rel_version: 1 },
    { def_id: P_SALES, name: "Duyệt nhanh Kinh doanh", rel_version: 2 },
  ];
  await page.route(`**/tenants/${tid}/process-routing/${SLOT}`, async (r) => {
    if (r.request().method() === "GET")
      return json(r, 200, { slot: SLOT, version: st.version, rules: st.rules, processes });
    const body = r.request().postDataJSON() as {
      version: number;
      rules: {
        condition: { departmentIds?: string[]; contractKinds?: string[] };
        def_id: string;
        is_default: boolean;
      }[];
    };
    st.puts.push(body);
    if (st.conflictNext || body.version !== st.version) {
      st.conflictNext = false;
      return json(r, 409, { error: { code: "VERSION_CONFLICT", message: "conflict" } });
    }
    st.version += 1;
    st.rules = body.rules.map((x, i) => ({ id: `r${st.version}-${i}`, priority: i, ...x }));
    return json(r, 200, { slot: SLOT, version: st.version, rules: st.rules, processes });
  });
  return { st, tid };
}

async function open(page: Page) {
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg.getByRole("button", { name: /Ứng dụng & quy trình/ }).click();
  return dlg;
}

test("tenant admin thêm luật theo phòng ban ⇒ người phòng đó khởi tạo đúng quy trình", async ({
  page,
}) => {
  const { st } = await install(page, "tenant_admin");
  const dlg = await open(page);
  await expect(dlg.getByTestId("apps-pane")).toBeVisible();
  await expect(dlg.getByTestId("apps-addons-contracts")).toContainText("han-muc-duyet: bật");
  await expect(dlg.getByTestId("routing-subdept-note")).toBeVisible();

  await dlg.getByTestId("routing-add").click();
  const rule = dlg.getByTestId("routing-rule-0");
  await rule.getByTestId("routing-rule-0-depts").click();
  await rule.getByTestId(`routing-rule-0-depts-${D_SALES}`).check();
  await rule.getByTestId("routing-rule-0-process").selectOption(P_SALES);
  await dlg.getByTestId("routing-add").click();
  await dlg.getByTestId("routing-rule-1-default").check();
  await dlg.getByTestId("routing-save").click();

  await expect.poll(() => st.puts.length).toBe(1);
  expect(st.puts[0]).toEqual({
    version: 0,
    rules: [
      { condition: { departmentIds: [D_SALES] }, def_id: P_SALES, is_default: false },
      { condition: {}, def_id: P_DEFAULT, is_default: true },
    ],
  });
  // Luật lưu đúng: người phòng Kinh doanh ⇒ quy trình "Duyệt nhanh Kinh doanh" (hub chọn bằng pickProcess; xem int routing-launch).
  const saved = st.rules.find((r) => r.condition.departmentIds?.includes(D_SALES));
  expect(saved?.def_id).toBe(P_SALES);
  await expect(dlg.getByTestId("routing-save")).toBeDisabled();
});

test("cr118-route-kind · luật phòng ban + loại HĐ (Mua) ⇒ PUT gửi contractKinds", async ({
  page,
}) => {
  const { st } = await install(page, "tenant_admin");
  const dlg = await open(page);
  await dlg.getByTestId("routing-add").click();
  const rule = dlg.getByTestId("routing-rule-0");
  await rule.getByTestId("routing-rule-0-depts").click();
  await rule.getByTestId(`routing-rule-0-depts-${D_SALES}`).check();
  await rule.getByTestId("routing-rule-0-depts").locator("summary").click(); // đóng hộp phòng ban
  await expect(rule.getByTestId("routing-rule-0-kinds")).toContainText("Mọi loại hợp đồng");
  await rule.getByTestId("routing-rule-0-kinds").locator("summary").click();
  await rule.getByTestId("routing-rule-0-kinds-buy").check();
  await expect(rule.getByTestId("routing-rule-0-kinds").locator("summary")).toHaveText("Mua");
  await rule.getByTestId("routing-rule-0-kinds").locator("summary").click(); // đóng hộp loại (che nút Lưu)
  await rule.getByTestId("routing-rule-0-process").selectOption(P_SALES);
  await dlg.getByTestId("routing-save").click();
  await expect.poll(() => st.puts.length).toBe(1);
  expect(st.puts[0]).toEqual({
    version: 0,
    rules: [
      {
        condition: { departmentIds: [D_SALES], contractKinds: ["buy"] },
        def_id: P_SALES,
        is_default: false,
      },
    ],
  });
  await expect(dlg.getByTestId("routing-save")).toBeDisabled();
});

test("409: báo 'đã có người sửa', giữ bản nháp, Tải lại lấy bản mới", async ({ page }) => {
  const { st } = await install(page, "tenant_admin");
  const dlg = await open(page);
  await dlg.getByTestId("routing-add").click();
  await dlg.getByTestId("routing-rule-0-default").check();
  st.conflictNext = true;
  await dlg.getByTestId("routing-save").click();
  await expect(dlg.getByTestId("routing-error")).toContainText("Đã có người sửa");
  await expect(dlg.getByTestId("routing-rule-0")).toBeVisible();
  await dlg.getByTestId("routing-error").getByRole("button", { name: "Tải lại" }).click();
});

test("thành viên không thấy mục 'Ứng dụng & quy trình'", async ({ page }) => {
  await install(page, "member");
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  const item = page.getByRole("menuitem", { name: "Cài đặt" }).first();
  if (await item.isVisible()) {
    await item.click();
    const dlg = page.getByRole("dialog", { name: "Cài đặt" });
    await expect(dlg.getByRole("button", { name: /Ứng dụng & quy trình/ })).toHaveCount(0);
  }
});

test("sơ đồ xem được cho MỌI quy trình đã gán, nạp khi mở, 404 ⇒ báo không xem được", async ({
  page,
}) => {
  const { tid } = await install(page, "tenant_admin");
  const hits: string[] = [];
  await page.route(`**/tenants/${tid}/process-routing/${SLOT}/processes/*`, (r) => {
    const id = r.request().url().split("/").pop() ?? "";
    hits.push(id);
    if (id === P_DEFAULT)
      return json(r, 404, { error: { code: "NOT_FOUND", message: "not found" } });
    return json(r, 200, {
      def_id: P_SALES,
      slot: SLOT,
      name: "Duyệt nhanh Kinh doanh",
      rel_version: 2,
      stages: [],
      slot_body: {
        steps: [
          {
            kind: "review",
            key: "s1",
            name: "Trưởng phòng duyệt",
            department_group_key: "sales",
            head_only: true,
            due_h: 24,
            remind_every_h: null,
            when: null,
          },
        ],
      },
    });
  });
  const dlg = await open(page);
  await expect(dlg.getByTestId(`slot-process-${P_SALES}`)).toBeVisible();
  expect(hits).toEqual([]);
  await dlg.getByTestId(`slot-diagram-toggle-${P_SALES}`).click();
  await expect(dlg.getByTestId("flow-canvas")).toBeVisible();
  await expect(dlg.getByTestId("flow-canvas")).toContainText("Trưởng phòng duyệt");
  await dlg.getByTestId(`slot-diagram-toggle-${P_DEFAULT}`).click();
  await expect(dlg.getByTestId("slot-diagram-unavailable")).toBeVisible();
  expect(hits.sort()).toEqual([P_DEFAULT, P_SALES].sort());
});

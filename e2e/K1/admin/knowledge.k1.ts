// HUB-FR-132 · HUB-BR-35 · K1-AC07 (vế UI) · plan-frontend K1 §2, §4–§5 (nhãn VI nguyên văn) · spec §3.3 · test-plan K1 §4
// E20–E24: admin-web → Quy trình → thẻ "Tri thức" (project mặc định + theo stage, `effective`, [Lưu tri thức] riêng) + Dialog
// "Tri thức" bật theo công ty. Stack P-b2 thật (def `pb2-par`); route KH của Hub giả lập bằng `page.route` theo contract.
// Đỏ trước code: thẻ/region "Tri thức" chưa có ⇒ đỏ ở locator.
import { expect, type Page, test } from "@playwright/test";
import { adminLogin, DEF_PAR, openDef } from "../../P-b2/_pb2-support";

const PROJECTS = [
  { project_id: "proj-a", label: "Dự án A", read_only: false },
  { project_id: "proj-shared", label: "Dùng chung", read_only: true },
];
const KEYS = DEF_PAR.stages.map((s) => s.key);
const eff = (pid: string | null, ro = false) =>
  KEYS.map((k) => ({
    stage_key: k,
    project_id: pid,
    read_only: ro,
    summary_required: pid !== null && !ro,
  }));
type St = {
  kh: {
    available: boolean;
    reason: string | null;
    enabled: boolean;
    projects: typeof PROJECTS;
    version: number | null;
  };
  binding: Record<string, unknown>;
  puts: { path: string; body: Record<string, unknown> }[];
  once: Record<string, { status: number; body: unknown }>;
};
async function mockKh(p: Page, o: Partial<St> = {}): Promise<St> {
  const st: St = {
    kh: { available: true, reason: null, enabled: true, projects: PROJECTS, version: 2 },
    binding: {
      process_def_id: DEF_PAR.id,
      project_id: "proj-a",
      stage_projects: {},
      version: 1,
      effective: eff("proj-a"),
    },
    puts: [],
    once: {},
    ...o,
  };
  await p.route(/\/admin\/kh(\/enabled)?(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const b = req.postDataJSON() as Record<string, unknown>;
      st.puts.push({ path: "/admin/kh/enabled", body: b });
      st.kh = { ...st.kh, enabled: Boolean(b.enabled), version: (st.kh.version ?? 0) + 1 };
    }
    return route.fulfill({ status: 200, json: st.kh });
  });
  await p.route(/\/process-defs\/[^/]+\/knowledge(\?.*)?$/, async (route) => {
    const req = route.request();
    const one = st.once[req.method()];
    if (one) {
      delete st.once[req.method()];
      return route.fulfill({ status: one.status, json: one.body });
    }
    if (req.method() === "PUT") {
      const b = req.postDataJSON() as Record<string, unknown>;
      st.puts.push({ path: new URL(req.url()).pathname, body: b });
      st.binding = { ...st.binding, ...b, version: 2 };
    }
    return route.fulfill({ status: 200, json: st.binding });
  });
  return st;
}
const card = (p: Page) => p.getByRole("region", { name: "Tri thức" });
const stageBox = (p: Page, name: string) =>
  card(p).getByRole("combobox", { name: `Project tri thức của stage ${name}` });

test("HUB-FR-132 · E20 · thẻ 'Tri thức' của pb2-par: combobox 'Project tri thức' = Dự án A, mỗi stage có combobox, hiệu lực 'Cần Tóm tắt'", async ({
  page,
}) => {
  await mockKh(page);
  await openDef(page, DEF_PAR.key, DEF_PAR.name);
  await expect(card(page).getByRole("combobox", { name: "Project tri thức" })).toContainText(
    "Dự án A",
  );
  for (const s of DEF_PAR.stages) await expect(stageBox(page, s.name)).toBeVisible();
  await expect(card(page)).toContainText("Cần Tóm tắt");
  await expect(card(page)).toContainText("Stage sẽ bắt buộc có mục ## Tóm tắt (≤ 200 từ).");
});

test("HUB-FR-132 · E21 · stage 'Rà soát code' → 'Không dùng', [Lưu tri thức] ⇒ PUT {project_id, stage_projects {ra-soat: null}, version}", async ({
  page,
}) => {
  const st = await mockKh(page);
  await openDef(page, DEF_PAR.key, DEF_PAR.name);
  await stageBox(page, "Rà soát code").click();
  await page.getByRole("option", { name: "Không dùng", exact: true }).click();
  const put = page.waitForRequest((r) => r.method() === "PUT" && /\/knowledge$/.test(r.url()));
  await card(page).getByRole("button", { name: "Lưu tri thức" }).click();
  expect((await put).postDataJSON()).toEqual({
    project_id: "proj-a",
    stage_projects: { "ra-soat": null },
    version: 1,
  });
  expect(st.puts.map((x) => x.path)).toEqual([`/process-defs/${DEF_PAR.id}/knowledge`]);
});

test("HUB-FR-132 · E22 · project chỉ đọc ⇒ badge 'Chỉ đọc' + câu 'Project dùng chung chỉ đọc: không ghi Tóm tắt vào đây.'", async ({
  page,
}) => {
  await mockKh(page, {
    binding: {
      process_def_id: DEF_PAR.id,
      project_id: "proj-shared",
      stage_projects: {},
      version: 1,
      effective: eff("proj-shared", true),
    },
  });
  await openDef(page, DEF_PAR.key, DEF_PAR.name);
  await expect(card(page)).toContainText("Chỉ đọc");
  await expect(card(page)).toContainText("Project dùng chung chỉ đọc: không ghi Tóm tắt vào đây.");
  await expect(card(page)).not.toContainText("Cần Tóm tắt");
});

test("HUB-FR-132 · Q5 · E23 · available=false not_configured ⇒ Select disabled + 'Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty'; KH_PROJECT_NOT_FOUND ⇒ toast", async ({
  page,
}) => {
  const st = await mockKh(page, {
    kh: { available: false, reason: "not_configured", enabled: false, projects: [], version: null },
  });
  await openDef(page, DEF_PAR.key, DEF_PAR.name);
  await expect(card(page).getByRole("combobox", { name: "Project tri thức" })).toBeDisabled();
  await expect(card(page)).toContainText(
    "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty",
  );
  st.kh = { available: true, reason: null, enabled: true, projects: PROJECTS, version: 2 };
  st.once.PUT = { status: 404, body: { error: { code: "KH_PROJECT_NOT_FOUND", message: "x" } } };
  await page.reload();
  await card(page).getByRole("button", { name: "Lưu tri thức" }).click();
  await expect(page.getByText("Project không còn trong danh sách của công ty")).toBeVisible();
});

test("HUB-FR-132 · E24 · trang Quy trình: [Tri thức] ⇒ dialog 'Tri thức', switch 'Dùng tri thức cho công ty' tắt ⇒ PUT /admin/kh/enabled {enabled:false, version}", async ({
  page,
}) => {
  const st = await mockKh(page);
  await adminLogin(page);
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Quy trình", exact: true })
    .click();
  await page.getByRole("button", { name: "Tri thức", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Tri thức" });
  const sw = dlg.getByRole("switch", { name: "Dùng tri thức cho công ty" });
  await expect(sw).toBeChecked();
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && /\/admin\/kh\/enabled$/.test(r.url()),
  );
  await sw.click();
  expect((await put).postDataJSON()).toEqual({ enabled: false, version: 2 });
  await expect(sw).not.toBeChecked();
  expect(st.puts).toHaveLength(1);
});

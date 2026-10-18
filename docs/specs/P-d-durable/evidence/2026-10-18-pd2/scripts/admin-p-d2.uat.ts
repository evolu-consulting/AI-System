// UAT P-d2 · admin-web: F1 công tắc tool (tab "Tool quy trình") · F2 editor stage tool · F3 rẽ nhánh · kiểm lại B1/B2/B5.
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { tok } from "../../../../../../e2e/P-a/_pa-support";
import { TENANT_ID } from "../../../../../../tests/acceptance/M1/_data";
import { PA_E2E } from "../../../../../../e2e/P-a/_pa-data";
import {
  adminLogin,
  clearAcmeSwitch,
  loginAs,
  mkRoom,
  node,
  openDef,
  panel,
  PD2_E2E,
  saveDef,
  seedTimerRun,
  withSql,
} from "../../../../../../e2e/P-d/_pd-support";
import { EV, seedUat, shot, step } from "./uat-lib";

const ADMIN = process.env.PA_ADMIN_URL ?? "http://localhost:5305";
const API = process.env.X2A_API_URL ?? "http://localhost:5301";
const MOCK = "docs/specs/P-d-durable/mockup";

async function platformLogin(p: Page) {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  // biome-ignore lint/style/noNonNullAssertion: env
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(process.env.SEED_ADMIN_USERNAME!);
  // biome-ignore lint/style/noNonNullAssertion: env
  await p.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD!);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const resetSwitches = () => seedUat();

test("M0 · chụp mockup 04 (P-d2) để so sánh", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "vi-VN" });
  const p = await ctx.newPage();
  await step("M-04", "chụp mockup 04-admin-quy-trinh-p-d2", p, async () => {
    await p.goto(pathToFileURL(`${process.cwd()}/${MOCK}/04-admin-quy-trinh-p-d2.html`).href);
    await p.screenshot({ path: `${EV}/mockup/04-admin-quy-trinh-p-d2.png`, fullPage: true });
    return (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1500);
  });
  await ctx.close();
});

test("F1 · công tắc tool theo tenant", async ({ page: p, browser }) => {
  await seedUat();
  await clearAcmeSwitch();
  const tbl = () => p.getByRole("table", { name: "Tool quy trình" });
  const sw = () => tbl().getByRole("switch", { name: `Bật tool ${PD2_E2E.W.name}` });
  await step("F1a", "platform_admin: tab 'Tool quy trình' + bảng (huy hiệu Tác dụng phụ / Workflow đang tắt)", p, async () => {
    await platformLogin(p);
    await p.goto(`/tenants/${TENANT_ID.acme}`);
    await p.getByRole("tab", { name: "Tool quy trình" }).click();
    await expect(tbl()).toBeVisible();
    await expect(tbl().getByRole("row").filter({ hasText: PD2_E2E.WOFF.name })).toContainText("Workflow đang tắt");
    await expect(tbl().getByRole("row").filter({ hasText: PD2_E2E.WS.name })).toContainText("Tác dụng phụ");
    await shot(p, "F1-01-tab-tool-quy-trinh", true);
  });
  await step("F1b", "bật 'Xuất HĐ' không hỏi ⇒ PUT 200 + toast", p, async () => {
    const put = p.waitForResponse((r) => r.request().method() === "PUT" && /workflow-tools/.test(r.url()));
    await sw().click();
    const r = await put;
    expect(r.status()).toBe(200);
    await expect(p.getByText(/Đã bật tool Xuất HĐ cho/)).toBeVisible();
    await shot(p, "F1-02-bat-toast");
    return `PUT ${new URL(r.url()).pathname}`;
  });
  await step("F1c", "tắt ⇒ hộp xác nhận (Huỷ giữ nguyên; 'Tắt tool' ⇒ DELETE 200)", p, async () => {
    await sw().click();
    const dlg = p.getByRole("alertdialog", { name: "Tắt tool Xuất HĐ?" });
    await expect(dlg).toContainText("Lượt chạy đang chờ gọi tool này sẽ dừng ở “Cần người quyết”.");
    await shot(p, "F1-03-hop-tat-tool");
    await dlg.getByRole("button", { name: "Huỷ" }).click();
    await expect(sw()).toBeChecked();
    await sw().click();
    const del = p.waitForResponse((r) => r.request().method() === "DELETE" && /workflow-tools/.test(r.url()));
    await p.getByRole("alertdialog", { name: "Tắt tool Xuất HĐ?" }).getByRole("button", { name: "Tắt tool" }).click();
    expect((await del).status()).toBe(200);
    await expect(sw()).not.toBeChecked();
    await shot(p, "F1-04-sau-tat");
  });
  await step("F1d", "tìm 'Tìm tool': khớp 1 / không khớp (rỗng)", p, async () => {
    const q = p.getByRole("searchbox", { name: "Tìm tool" });
    await q.fill("ghi");
    await shot(p, "F1-05-tim-ghi");
    const rows = await tbl().getByRole("row").count();
    await q.fill("zzzz-khong-co");
    await shot(p, "F1-06-tim-rong");
    return `sau 'ghi': ${rows} dòng (gồm tiêu đề); rỗng: ${(await p.locator("body").innerText()).match(/Không[^\n]{0,80}/g)?.slice(0, 3).join(" / ")}`;
  });
  await step("F1e", "lỗi bật (PUT 500 giả lập) ⇒ công tắc về cũ + thông báo lỗi", p, async () => {
    await p.getByRole("searchbox", { name: "Tìm tool" }).fill("");
    await p.route(/workflow-tools/, (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }) }) : route.continue()));
    await sw().click();
    await expect(sw()).not.toBeChecked();
    await shot(p, "F1-07-loi-bat");
    const txt = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    await p.unroute(/workflow-tools/);
    return `(giả lập page.route 500) thông báo: ${txt.match(/(Không|Lỗi|thất bại)[^.]{0,100}/)?.[0] ?? "không thấy"}`;
  });
  await step("F1f", "tenant_admin (binh): không thấy trang/tab tenant; API PUT workflow-tools ⇒ 403", undefined, async () => {
    const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 800 } });
    const t = await ctx.newPage();
    await adminLogin(t);
    await t.goto(`${ADMIN}/tenants/${TENANT_ID.acme}`);
    await shot(t, "F1-08-tenant-admin-khong-quyen");
    const body = (await t.locator("body").innerText()).replace(/\s+/g, " ");
    const hasTab = await t.getByRole("tab", { name: "Tool quy trình" }).count();
    const token = await tok("Adm");
    const res = await fetch(`${API}/admin/tenants/${TENANT_ID.acme}/workflow-tools/${PD2_E2E.W.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    await ctx.close();
    if (hasTab) throw new Error("tenant_admin thấy tab 'Tool quy trình'");
    if (res.status !== 403) throw new Error(`PUT bằng tenant_admin trả ${res.status}, mong 403`);
    return `trang: ${body.slice(0, 80)}; PUT ⇒ ${res.status}`;
  });
});

const TOOL_OPT = "Xuất HĐ · xuat-hoa-don";
test("F2 · soạn stage 'Gọi tool'", async ({ page: p }) => {
  await seedUat();
  await openDef(p, "pd2-tool", "Gọi tool E2E");
  await step("F2a", "stage 'Xuất hoá đơn' ⇒ Người thực hiện 'Gọi tool'; chọn tool từ catalog", p, async () => {
    await node(p, "Xuất hoá đơn").click();
    await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
    await shot(p, "F2-01-nguoi-thuc-hien");
    await p.getByRole("option", { name: "Gọi tool" }).click();
    const g = panel(p).getByRole("group", { name: "Gọi tool" });
    await g.getByRole("combobox", { name: "Tool" }).click();
    await shot(p, "F2-02-catalog-tool");
    const opts = await p.getByRole("option").allInnerTexts();
    await p.getByRole("option", { name: TOOL_OPT }).click();
    return `option: ${opts.join(" | ")}`;
  });
  await step("F2b", "lỗi live TOOL_INVALID khi tham số bắt buộc tong_tien còn trống", p, async () => {
    const g = panel(p).getByRole("group", { name: "Gọi tool" });
    await shot(p, "F2-03-tham-so-trong", true);
    const t = (await g.innerText()).replace(/\s+/g, " ");
    if (!/bắt buộc|chưa|Chọn|thiếu/i.test(t)) throw new Error(`không thấy lỗi tham số bắt buộc: ${t.slice(0, 300)}`);
    return t.slice(0, 400);
  });
  await step("F2c", "map tham số: tong_tien ⇐ trường bước trước; ma_kh = 'KH1'; Lưu 200; tải lại giữ", p, async () => {
    const g = panel(p).getByRole("group", { name: "Gọi tool" });
    await g.getByRole("combobox", { name: "Nguồn của tham số tong_tien" }).click();
    await shot(p, "F2-04-nguon-tham-so");
    await p.getByRole("option", { name: "Kết quả giai đoạn trước" }).click();
    await g.getByRole("combobox", { name: "Giá trị của tham số tong_tien" }).click();
    await p.getByRole("option", { name: /Giai đoạn 1 · tong_tien/ }).click();
    await g.getByRole("combobox", { name: "Nguồn của tham số ma_kh" }).click();
    await p.getByRole("option", { name: "Giá trị cố định" }).click();
    await g.getByLabel("Giá trị của tham số ma_kh").fill("KH1");
    await shot(p, "F2-05-map-day-du", true);
    expect(await saveDef(p)).toBe(200);
    await p.reload();
    await node(p, "Xuất hoá đơn").click();
    const g2 = panel(p).getByRole("group", { name: "Gọi tool" });
    await expect(g2.getByRole("combobox", { name: "Tool" })).toContainText("Xuất HĐ");
    await expect(g2.getByLabel("Giá trị của tham số ma_kh")).toHaveValue("KH1");
    await shot(p, "F2-06-sau-tai-lai", true);
  });
  await step("F2d", "tool 'Ghi sổ' (side_effect): huy hiệu 'Tác dụng phụ' + real_action", p, async () => {
    const g = panel(p).getByRole("group", { name: "Gọi tool" });
    await g.getByRole("combobox", { name: "Tool" }).click();
    await expect(p.getByRole("option", { name: /Tải tệp · tai-tep/ })).toBeDisabled();
    await p.getByRole("option", { name: /Ghi sổ · ghi-so/ }).click();
    await expect(g.getByText("Tác dụng phụ")).toBeVisible();
    await shot(p, "F2-07-tool-tac-dung-phu", true);
    const all = (await panel(p).innerText()).replace(/\s+/g, " ");
    const cb = await panel(p).getByRole("checkbox").allInnerTexts();
    return `panel: ${all.slice(0, 700)} | checkbox: ${cb.join(",")}`;
  });
  await step("F2e", "bật 'real_action' cho tool side_effect (mô tả ràng buộc bước trước có gate)", p, async () => {
    const real = panel(p).getByRole("switch", { name: /Hành động thật/ });
    if (!(await real.count())) throw new Error(`không thấy ô real_action; checkbox: ${(await panel(p).getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.id))).join(",")}`);
    await real.click();
    await shot(p, "F2-08-real-action", true);
    return (await panel(p).innerText()).replace(/\s+/g, " ").slice(0, 600);
  });
  await step("F2f", "tool bị tắt sau khi đã lưu ⇒ PROCESS_REF_INVALID (Lưu bị chặn / báo lỗi tool tắt)", p, async () => {
    // đặt lại def với tool 'xuat-hoa-don', rồi platform tắt công tắc ⇒ mở editor + Lưu
    await withSql(async (sql) => {
      const [d] = await sql<{ stages: any[] }[]>`select stages from hub.process_defs where id = ${PD2_E2E.defTool}`;
      const st = d?.stages ?? [];
      st[1].executor = { kind: "tool", tool_key: "xuat-hoa-don", args: { tong_tien: { from: "field", stage_key: "doc", field: "tong_tien" }, ma_kh: { from: "const", value: "KH1" } } };
      await sql`update hub.process_defs set stages = ${sql.json(st)}, version = version + 1 where id = ${PD2_E2E.defTool}`;
      await sql`delete from admin.tenant_workflow_tools where workflow_id = ${PD2_E2E.W.id} and tenant_id = ${TENANT_ID.acme}`;
      await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    });
    await p.reload();
    await node(p, "Xuất hoá đơn").click();
    await shot(p, "F2-09-tool-tat-mo-editor", true);
    const live = (await panel(p).innerText()).replace(/\s+/g, " ");
    const put = p.waitForResponse((r) => r.request().method() === "PUT" && /process-defs/.test(r.url()), { timeout: 8000 }).then(async (r) => `${r.status()} ${(await r.text()).slice(0, 250)}`, () => "không gửi PUT");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    const res = await put;
    await shot(p, "F2-10-tool-tat-sau-luu", true);
    const after = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    return `live: ${live.slice(0, 300)} || Lưu: ${res} || sau Lưu: ${after.match(/(Tool|tool)[^.]{0,120}(tắt|không còn|không khả dụng)[^.]{0,60}/)?.[0] ?? "không thấy câu về tool tắt"}`;
  });
});

test("F3 · rẽ nhánh after.branch", async ({ page: p }) => {
  await seedUat();
  await openDef(p, "pd2-branch", "Rẽ nhánh E2E");
  await step("F3a", "stage 'Phân loại' ⇒ 'Rẽ nhánh': luật tong_tien ≥ 20000000 ⇒ Bước 4; Lưu 200; cạnh 'Rẽ nhánh · luật 1'", p, async () => {
    await node(p, "Phân loại").click();
    const g = panel(p).getByRole("group", { name: "Rẽ nhánh" });
    await shot(p, "F3-01-re-nhanh-rong", true);
    await g.getByRole("button", { name: "Thêm luật rẽ nhánh" }).click();
    await g.getByRole("combobox", { name: "Nếu trường" }).click();
    await shot(p, "F3-02-nếu-truong");
    await p.getByRole("option", { name: /tong_tien/ }).click();
    await g.getByRole("combobox", { name: "Phép so sánh" }).click();
    await shot(p, "F3-03-phep-so-sanh");
    await p.getByRole("option", { name: "lớn hơn hoặc bằng" }).click();
    await g.getByLabel("Giá trị", { exact: true }).fill("20000000");
    await g.getByRole("combobox", { name: "Thì tới bước" }).click();
    await shot(p, "F3-04-toi-buoc");
    await p.getByRole("option", { name: "Bước 4" }).click();
    await shot(p, "F3-05-luat-day-du", true);
    expect(await saveDef(p)).toBe(200);
    await expect(p.getByText("Rẽ nhánh · luật 1")).toBeVisible();
    await shot(p, "F3-06-canh-re-nhanh", true);
  });
  await step("F3b", "tải lại giữ luật; thêm luật 2 trùng đích; xoá luật 1", p, async () => {
    await p.reload();
    await node(p, "Phân loại").click();
    const g = panel(p).getByRole("group", { name: "Rẽ nhánh" });
    await expect(g.getByRole("combobox", { name: "Thì tới bước" })).toContainText("Bước 4");
    await expect(g.getByLabel("Giá trị", { exact: true })).toHaveValue("20000000");
    await shot(p, "F3-07-sau-tai-lai", true);
    await g.getByRole("button", { name: "Xoá luật 1" }).click();
    expect(await saveDef(p)).toBe(200);
    await expect(p.getByText("Rẽ nhánh · luật 1")).toHaveCount(0);
    await shot(p, "F3-08-sau-xoa", true);
  });
  await step("F3c", "lỗi live: luật 'tới bước' ≤ bước hiện tại (BRANCH_INVALID)", p, async () => {
    await node(p, "Bước ba").click();
    const g = panel(p).getByRole("group", { name: "Rẽ nhánh" });
    await g.getByRole("button", { name: "Thêm luật rẽ nhánh" }).click();
    await shot(p, "F3-09-luat-chua-day-du", true);
    const t = (await g.innerText()).replace(/\s+/g, " ");
    return t.slice(0, 500);
  });
});

test("B1/B2 · kiểm lại lỗi live editor P-d1", async ({ page: p }) => {
  await seedUat();
  const sid = (n: number) => `d1e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const TEAM = sid(901);
  const DEF_TEAM = sid(902);
  await step("B2", "ttl_days = 400 ⇒ báo 'Từ 1 đến 365 ngày' NGAY (không cần Lưu)", p, async () => {
    await openDef(p, "pd-edit", "Chờ hạn E2E");
    const days = p.getByRole("spinbutton", { name: "Thời hạn lượt chạy (ngày)" });
    await days.fill("400");
    await shot(p, "F7-07-B2-ttl-400-live", true);
    const txt = await p.locator("body").innerText();
    if (!/1 đến 365/.test(txt)) throw new Error("không thấy 'Từ 1 đến 365 ngày' trước khi Lưu");
  });
  await step("B1", "TEAM_SECTION_UNOWNED hiện NGAY khi mở stage team tuần tự", p, async () => {
    await withSql(async (sql) => {
      await sql`insert into hub.agent_teams (id, key, name, mode) values (${TEAM}, 'uat-seq', ${sql.json({ vi: "Nhóm UAT tuần tự", en: "UAT seq" })}, 'sequential') on conflict (id) do nothing`;
      await sql`delete from hub.agent_team_members where team_id = ${TEAM}`;
      await sql`insert into hub.agent_team_members (team_id, agent_id, role, sections, position) values (${TEAM}, ${PA_E2E.agentRead}, 'Phân tích', '{"Phần B"}'::text[], 0)`;
      await sql`insert into hub.agent_team_entitlements (team_id, tenant_id) values (${TEAM}, ${TENANT_ID.acme}) on conflict do nothing`;
      const stage = { key: "nhom", name: "Nhóm tuần tự", step: 0, executor: { kind: "team", team_id: TEAM }, instruction: "Thực hiện nhóm.", output: { filename: "nhom.md", template: "## Kết quả\n", required_sections: ["Kết quả"], fields: [] }, after: { kind: "auto" }, real_action: false, answerer: { kind: "starter" }, timeout_s: 1800, token_budget: null, sources: [], must_know: [] };
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled, version, sources, inputs)
        values (${DEF_TEAM}, ${TENANT_ID.acme}, 'uat-team', 'Nhóm thiếu mục', 'UAT', 'x', '{}'::uuid[], ${sql.json([stage] as never)}, null, true, 1, ${sql.json([])}, ${sql.json([])})
        on conflict (id) do update set stages = excluded.stages`;
      await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    });
    await p.goto(`${ADMIN}/`);
    await p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.reload();
    await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "uat-team" }).getByRole("link", { name: "Nhóm thiếu mục" }).click();
    await node(p, "Nhóm tuần tự").click();
    const live = await p.getByText(/không thành viên nào của nhóm phụ trách/).count();
    await shot(p, "F7-08-B1-team-section-live", true);
    if (live === 0) throw new Error("lỗi TEAM_SECTION_UNOWNED KHÔNG hiện live khi mở stage");
  });
});

test("B5 · Admin Lượt chạy: huy hiệu retry + cột Giai đoạn", async ({ page: p }) => {
  await seedUat();
  const room = await mkRoom("UAT-B5A");
  const wait = await seedTimerRun(room.id, "wait");
  const retry = await seedTimerRun(room.id, "retry");
  await step("B5", "Lượt chạy: run retry ⇒ huy hiệu 'Đang thử lại…' (không 'Đang chờ hẹn'); cột Giai đoạn 'Chờ tới…/Thử lại lúc…'", p, async () => {
    expect(wait.ready && retry.ready).toBe(true);
    await adminLogin(p);
    await p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "hoa-don-t" }).getByRole("link", { name: "Hoá đơn T" }).click();
    await p.getByRole("tab", { name: "Lượt chạy" }).click();
    await expect(p.getByRole("table").first()).toBeVisible();
    await shot(p, "F7-09-B5-ds-luot-chay", true);
    const rows = await p.getByRole("row").allInnerTexts();
    const t = rows.map((r) => r.replace(/\s+/g, " ")).filter((r) => /Đang|Chờ|Thử/.test(r));
    const ok = /Thử lại lúc/.test(t.join("|")) && /Chờ tới/.test(t.join("|"));
    if (!ok) throw new Error(`thiếu 'Chờ tới…' / 'Thử lại lúc…' ở cột Giai đoạn: ${t.slice(0, 6).join(" || ")}`);
    return t.slice(0, 6).join(" || ");
  });
  await step("B5b", "chi tiết run retry: bảng giai đoạn + huy hiệu", p, async () => {
    const url = p.url();
    await p.getByRole("row").filter({ hasText: /Thử lại/ }).first().getByRole("link").first().click().catch(() => {});
    await expect(p.getByRole("tab", { name: "Tiến độ" })).toBeVisible();
    await shot(p, "F7-10-B5-chi-tiet-retry", true);
    return `${url} → ${p.url()} :: ${(await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400)}`;
  });
});



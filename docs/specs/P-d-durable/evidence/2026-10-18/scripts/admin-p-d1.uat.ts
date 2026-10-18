// UAT P-d1 · admin-web: F1 Múi giờ · F2 editor (Chờ tới ngày, nhắc/chuyển cấp, ttl, lỗi live) · F4 Run view. Không sửa code/test khoá.
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { TENANT_ID } from "../../../../../../tests/acceptance/M1/_data";
import { PA_E2E } from "../../../../../../e2e/P-a/_pa-data";
import {
  adminLogin,
  node,
  openDef,
  panel,
  saveDef,
  seedPd,
  seedTimerRun,
  settle,
  withSql,
} from "../../../../../../e2e/P-d/_pd-support";
import { EV, shot, step } from "./uat-lib";

const ADMIN = process.env.PA_ADMIN_URL ?? "http://localhost:5305";
const TZ = (p: Page) => p.getByRole("textbox", { name: "Múi giờ" });
const MOCK = "docs/specs/P-d-durable/mockup";
const sid = (n: number) => `d1e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEAM = sid(901);
const DEF_TEAM = sid(902);

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

const resetTz = () =>
  withSql(
    (sql) =>
      sql`update admin.tenants set timezone = 'Asia/Ho_Chi_Minh' where id = ${TENANT_ID.acme}`,
  );

test.afterAll(async () => {
  await resetTz();
  await settle();
});

test("M0 · chụp mockup 01-03 để so sánh", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "vi-VN" });
  const p = await ctx.newPage();
  for (const f of [
    "01-admin-quy-trinh-p-d1",
    "02-admin-tenant",
    "03-chat-trang-thai",
  ]) {
    await step(`M-${f}`, `chụp mockup ${f}`, p, async () => {
      await p.goto(pathToFileURL(`${process.cwd()}/${MOCK}/${f}.html`).href);
      await p.screenshot({ path: `${EV}/mockup/${f}.png`, fullPage: true });
    });
  }
  await ctx.close();
});

test("F1 · Múi giờ tenant", async ({ page: p }) => {
  await resetTz();
  await step("F1a", "xem tab Thông tin, ô Múi giờ chỉ đọc", p, async () => {
    await platformLogin(p);
    await p.goto(`/tenants/${TENANT_ID.acme}`);
    await expect(TZ(p)).toHaveValue(/^Asia\/Ho_Chi_Minh/);
    await expect(TZ(p)).not.toBeEditable();
    await shot(p, "F1-01-tenant-thong-tin", true);
    return `giá trị: ${await TZ(p).inputValue()}`;
  });
  await step("F1b", "mở bộ chọn múi giờ, gõ 'ber'", p, async () => {
    await p.getByRole("button", { name: "Đổi múi giờ" }).click();
    await shot(p, "F1-02-chon-mui-gio-mo");
    await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("ber");
    await expect(p.getByRole("option", { name: "Europe/Berlin" })).toBeVisible();
    await shot(p, "F1-03-chon-mui-gio-ber");
    const n = await p.getByRole("option").count();
    return `${n} option sau khi gõ 'ber'`;
  });
  await step("F1c", "chọn Europe/Berlin ⇒ thanh lưu dính đáy; Lưu 200; tải lại giữ", p, async () => {
    await p.getByRole("option", { name: "Europe/Berlin" }).click();
    await shot(p, "F1-04-berlin-chua-luu");
    const put = p.waitForResponse(
      (r) => ["PATCH", "PUT"].includes(r.request().method()) && /\/tenants\/[0-9a-f-]{36}$/.test(r.url()),
    );
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    expect((await put).status()).toBe(200);
    await shot(p, "F1-05-sau-luu");
    await p.reload();
    await expect(TZ(p)).toHaveValue(/^Europe\/Berlin/);
    await shot(p, "F1-06-tai-lai-berlin", true);
  });
  await step("F1d", "múi giờ lạ (API 400) ⇒ alert", p, async () => {
    await resetTz();
    await p.route(/\/tenants\/[0-9a-f-]{36}$/, async (route) => {
      if (!["PATCH", "PUT"].includes(route.request().method())) return route.continue();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "invalid",
            details: { issues: [{ path: ["timezone"], message: "unsupported" }] },
          },
        }),
      });
    });
    await p.goto(`/tenants/${TENANT_ID.acme}`);
    await p.getByRole("button", { name: "Đổi múi giờ" }).click();
    await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("Berlin");
    await p.getByRole("option", { name: "Europe/Berlin" }).click();
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(
      p.getByRole("alert").filter({ hasText: "Múi giờ này chưa được hỗ trợ. Chọn một múi giờ khác trong danh sách." }),
    ).toBeVisible();
    await shot(p, "F1-07-loi-mui-gio-la");
    return "(giả lập: page.route trả 400, không có đường UI chọn múi giờ lạ)";
  });
  await step("F1e", "empty-search 'KHÔNG KHỚP'", p, async () => {
    await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("zzzz").catch(async () => {
      await p.getByRole("button", { name: "Đổi múi giờ" }).click();
      await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("zzzz");
    });
    await shot(p, "F1-08-khong-khop");
  });
});

async function seedTeamDef() {
  await withSql(async (sql) => {
    await sql`insert into hub.agent_teams (id, key, name, mode) values (${TEAM}, 'uat-seq', ${sql.json({ vi: "Nhóm UAT tuần tự", en: "UAT seq" })}, 'sequential') on conflict (id) do nothing`;
    await sql`delete from hub.agent_team_members where team_id = ${TEAM}`;
    await sql`insert into hub.agent_team_members (team_id, agent_id, role, sections, position)
      values (${TEAM}, ${PA_E2E.agentRead}, 'Phân tích', '{"Phần B"}'::text[], 0)`;
    await sql`insert into hub.agent_team_entitlements (team_id, tenant_id) values (${TEAM}, ${TENANT_ID.acme}) on conflict do nothing`;
    const stage = {
      key: "nhom",
      name: "Nhóm tuần tự",
      step: 0,
      executor: { kind: "team", team_id: TEAM },
      instruction: "Thực hiện nhóm.",
      output: { filename: "nhom.md", template: "## Kết quả\n", required_sections: ["Kết quả"], fields: [] },
      after: { kind: "auto" },
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 1800,
      token_budget: null,
      sources: [],
      must_know: [],
    };
    await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled, version, sources, inputs)
      values (${DEF_TEAM}, ${TENANT_ID.acme}, 'uat-team', 'Nhóm thiếu mục', 'UAT', 'x', '{}'::uuid[], ${sql.json([stage])}, null, true, 1, ${sql.json([])}, ${sql.json([])})
      on conflict (id) do update set stages = excluded.stages`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

test("F2 · Editor quy trình", async ({ page: p }) => {
  await seedPd();
  await step("F2a", "mở def pd-edit, chụp canvas gốc", p, async () => {
    await openDef(p, "pd-edit", "Chờ hạn E2E");
    await node(p, "Chờ hạn").click();
    await shot(p, "F2-01-canvas-goc", true);
  });
  await step("F2b", "đổi stage 'Chờ hạn' ⇒ Chờ tới ngày: nguồn/chênh lệch/giờ", p, async () => {
    await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
    await shot(p, "F2-02-nguoi-thuc-hien-list");
    await p.getByRole("option", { name: "Chờ tới ngày" }).click();
    const g = panel(p).getByRole("group", { name: "Chờ tới ngày" });
    await shot(p, "F2-03-cho-toi-ngay-rong");
    await g.getByRole("combobox", { name: "Lấy ngày từ" }).click();
    await shot(p, "F2-04-lay-ngay-tu-list");
    await p.getByRole("option", { name: /Kết quả giai đoạn 1 · .*ngay_het_han/ }).click();
    await g.getByRole("spinbutton", { name: "Chênh lệch (ngày)" }).fill("-3");
    await g.getByLabel("Giờ trong ngày").fill("09:00");
    await expect(g.getByRole("status")).toContainText("Theo múi giờ công ty: Asia/Ho_Chi_Minh");
    await shot(p, "F2-05-cho-toi-ngay-hop-le");
    return await g.getByRole("status").innerText();
  });
  await step("F2c", "Lưu ⇒ 200; huy hiệu 'Chờ tới ngày' trên canvas", p, async () => {
    expect(await saveDef(p)).toBe(200);
    await expect(p.getByRole("button", { name: /^Giai đoạn \d+: Chờ hạn/ })).toContainText("Chờ tới ngày");
    await shot(p, "F2-06-badge-canvas", true);
  });
  await step("F2d", "gate Duyệt: nhắc 4h + chuyển cấp 24h tới Giám đốc; lưu; tải lại giữ", p, async () => {
    await node(p, "Đọc hồ sơ").click();
    const pn = panel(p);
    await shot(p, "F2-07-gate-truoc");
    await pn.getByRole("spinbutton", { name: "Nhắc mỗi (giờ)" }).fill("4");
    await pn.getByRole("checkbox", { name: "Chuyển cấp nếu chưa ai kiểm" }).check();
    await pn.getByRole("spinbutton", { name: "Chuyển cấp sau (giờ)" }).fill("24");
    await pn.getByRole("combobox", { name: "Chuyển cấp tới nhóm" }).click();
    await shot(p, "F2-08-nhom-chuyen-cap-list");
    await p.getByRole("option", { name: "Giám đốc" }).click();
    await shot(p, "F2-09-nhac-chuyen-cap-hop-le");
    expect(await saveDef(p)).toBe(200);
    await p.reload();
    await node(p, "Đọc hồ sơ").click();
    await expect(panel(p).getByRole("spinbutton", { name: "Nhắc mỗi (giờ)" })).toHaveValue("4");
    await shot(p, "F2-10-sau-tai-lai");
  });
  await step("F2e", "lỗi live: nhắc 2 giờ (ngoài 4–168), chuyển cấp 1 giờ", p, async () => {
    const pn = panel(p);
    await pn.getByRole("spinbutton", { name: "Nhắc mỗi (giờ)" }).fill("2");
    await pn.getByRole("spinbutton", { name: "Chuyển cấp sau (giờ)" }).fill("1");
    await shot(p, "F2-11-loi-nhac-chuyen-cap");
    const t = await pn.innerText();
    return /4 đến 168/.test(t) ? "có câu 'Từ 4 đến 168 giờ'" : "KHÔNG thấy câu lỗi khoảng giờ";
  });
  await step("F2f", "ttl_days: 30 rồi 'Không hết hạn'", p, async () => {
    await p.reload();
    const days = p.getByRole("spinbutton", { name: "Thời hạn lượt chạy (ngày)" });
    await days.fill("30");
    await shot(p, "F2-12-ttl-30", true);
    expect(await saveDef(p)).toBe(200);
    await p.getByRole("checkbox", { name: "Không hết hạn" }).check();
    await expect(days).toBeDisabled();
    await shot(p, "F2-13-ttl-khong-het-han", true);
    expect(await saveDef(p)).toBe(200);
    await days.evaluate(() => {});
  });
  await step("F2g", "ttl_days: 0 / 400 ⇒ lỗi inline", p, async () => {
    await p.getByRole("checkbox", { name: "Không hết hạn" }).uncheck();
    const days = p.getByRole("spinbutton", { name: "Thời hạn lượt chạy (ngày)" });
    await days.fill("400");
    await shot(p, "F2-14-ttl-400-loi", true);
    const put400 = p.waitForResponse((r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()), { timeout: 5000 }).then((r) => r.status(), () => "không gửi PUT (chặn ở client)");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    const st400 = await put400;
    await shot(p, "F2-14b-ttl-400-sau-luu", true);
    const bodyTxt = await p.locator("body").innerText();
    return `Lưu với 400: ${st400}; câu lỗi 1–365: ${/1 đến 365/.test(bodyTxt)}`;
    const txt = await p.locator("body").innerText();
    return /1 đến 365/.test(txt) ? "có câu 'Từ 1 đến 365 ngày'" : "KHÔNG thấy câu lỗi 1–365";
  });
  await step("F2h", "WAIT_INVALID: nguồn ngày cùng bước (pd-bad)", p, async () => {
    p.on("dialog", (d) => void d.accept());
    await p.goto(`${ADMIN}/`);
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "pd-bad" }).getByRole("link", { name: "Chờ cùng bước" }).click();
    await node(p, "Chờ sai nguồn").click();
    const g = panel(p).getByRole("group", { name: "Chờ tới ngày" });
    await expect(g.getByText(/Nguồn ngày không hợp lệ/)).toBeVisible();
    await shot(p, "F2-15-wait-invalid", true);
    return await g.getByText(/Nguồn ngày không hợp lệ/).innerText();
  });
  await step("F2i", "TEAM_SECTION_UNOWNED: team sequential, mục bắt buộc không ai phụ trách", p, async () => {
    await seedTeamDef();
    await p.goto(`${ADMIN}/`);
    await p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.reload();
    await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "uat-team" }).getByRole("link", { name: "Nhóm thiếu mục" }).click();
    await node(p, "Nhóm tuần tự").click();
    const live = await p.getByText(/không thành viên nào của nhóm phụ trách/).count();
    await shot(p, "F2-16-team-section-unowned-live", true);
    const put = p.waitForResponse((r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()), { timeout: 5000 }).then(async (r) => `${r.status()} ${(await r.text()).slice(0, 200)}`, () => "không gửi PUT");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    const res = await put;
    await shot(p, "F2-17-team-section-sau-luu", true);
    const after = await p.getByText(/không thành viên nào của nhóm phụ trách/).count();
    if (live === 0) throw new Error(`lỗi live KHÔNG hiện; sau Lưu: ${res}; hiện sau Lưu: ${after}`);
  });
});

test("F4 · Run view admin: progress cell waiting / retrying", async ({ page: p }) => {
  const wait = await seedTimerRun(null as never, "wait");
  const retry = await seedTimerRun(null as never, "retry");
  await step("F4a", "danh sách Lượt chạy của def hoa-don-t: ô tiến độ", p, async () => {
    expect(wait.ready && retry.ready).toBe(true);
    await adminLogin(p);
    await p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "hoa-don-t" }).getByRole("link", { name: "Hoá đơn T" }).click();
    await p.getByRole("tab", { name: "Lượt chạy" }).click();
    await shot(p, "F4-01-ds-luot-chay", true);
    const t = await p.locator("body").innerText();
    return `Chờ tới: ${/Chờ tới/.test(t)} · Đang thử lại: ${/Đang thử lại/.test(t)}`;
  });
  await step("F4b", "trang run: wait", p, async () => {
    const link = p.getByRole("row").filter({ hasText: "Lan Tran" }).first().getByRole("link").first();
    await link.click();
    await expect(p.getByRole("tab", { name: "Tiến độ" })).toBeVisible();
    await shot(p, "F4-02-run-detail", true);
    const url = p.url();
    await p.goto(url.replace(/[0-9a-f-]{36}/, wait.runId));
    await expect(p.getByRole("tab", { name: "Tiến độ" })).toBeVisible();
    await shot(p, "F4-03-run-wait", true);
    return (await p.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " ");
  });
  await step("F4c", "trang run: retry", p, async () => {
    await p.goto(p.url().replace(wait.runId, retry.runId));
    await expect(p.getByRole("tab", { name: "Tiến độ" })).toBeVisible();
    await shot(p, "F4-04-run-retry", true);
    return (await p.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " ");
  });
});

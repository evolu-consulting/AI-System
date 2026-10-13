// HUB-FR-78 · HUB-BR-17 · AC-H4b2-04, AC-H4b2-05 (vế UI) · plan-frontend H4b2 §0 D9–D11, §2–§5 · spec §3 C · artboard
// `Access.dc.html` + mockup States · test-plan H4b2 §3 M30–M37: ma trận switch agent × tenant, cấp không cần xác nhận,
// thu hồi qua alertdialog nêu "N grant", drawer xem grant, agent tắt mờ, 409 ⇒ toast + tải lại, không quyền.
// Đỏ trước code: `/studio/access` chưa có ⇒ không thấy heading "Quyền agent".
import { expect, type Page, test } from "@playwright/test";
import { type Kho, mockH4b2, toast, writes } from "./_h4b2";
import { login, mockStudio, openAuthed } from "./_support";

const a = (n: number) => `e4b20000-0000-4000-8000-${String(300 + n).padStart(12, "0")}`;
const AG = { hoadon: a(1), assistant: a(2), sales: a(3), orchAcme: a(4) } as const;
const TN = { acme: a(11), beta: a(12) } as const;
const AT = "2026-10-01T08:00:00.000Z";
const agents = [
  {
    id: AG.hoadon,
    key: "hoadon",
    name: "Kiểm tra hoá đơn",
    enabled: true,
    is_orchestrator: false,
    only_tenant_id: null,
  },
  {
    id: AG.assistant,
    key: "assistant",
    name: "Trợ lý chung",
    enabled: true,
    is_orchestrator: false,
    only_tenant_id: null,
  },
  {
    id: AG.sales,
    key: "sales-report",
    name: "Báo cáo bán hàng",
    enabled: false,
    is_orchestrator: false,
    only_tenant_id: null,
  },
];
const tenants = [
  { id: TN.acme, key: "acme", name: "acme", active: true },
  { id: TN.beta, key: "beta-co", name: "beta-co", active: true },
];
const ck = (ag: string, t: string) => `${ag}|${t}`;

/** Mock `/agent-entitlements*` (spec §3 C): ô đã cấp ở `k.cells`; PUT/DELETE đổi ô, trả `affected_grants`. */
function entitlements(k: Kho, m: string, seg: string[]) {
  const [ag, t] = seg;
  const cells = Object.entries(k.cells).map(([key, v]) => {
    const [agent_id, tenant_id] = key.split("|");
    const n = v.grants.group + v.grants.user + v.grants.tenant;
    return { agent_id, tenant_id, granted_at: AT, grant_count: n, grants: v.grants };
  });
  if (!ag)
    return {
      status: 200,
      json: { agents, tenants, cells, truncated: false, hub_config_version: 18 },
    };
  const cur = k.cells[ck(ag, t ?? "")];
  const n = cur ? cur.grants.group + cur.grants.user + cur.grants.tenant : 0;
  if (m === "GET")
    return {
      status: 200,
      json: {
        agent: { id: ag, key: agents.find((x) => x.id === ag)?.key, name: "x" },
        tenant: { id: t, key: "acme", name: "acme" },
        entitled: !!cur,
        granted_at: cur ? AT : null,
        granted_by: cur ? { id: a(90), username: "padmin" } : null,
        revoked_at: null,
        grants: [
          {
            id: a(50),
            subject_type: "group",
            subject: { id: a(60), name: "Kế toán" },
            granted_by_username: "tadmin",
            granted_at: AT,
          },
          {
            id: a(51),
            subject_type: "user",
            subject: { id: a(61), name: "lan" },
            granted_by_username: "tadmin",
            granted_at: AT,
          },
        ].slice(0, n),
        grants_truncated: false,
      },
    };
  if (m === "PUT") k.cells[ck(ag, t ?? "")] = cur ?? { grants: { group: 0, user: 0, tenant: 0 } };
  else delete k.cells[ck(ag, t ?? "")];
  return { status: 200, json: { hub_config_version: 19, affected_grants: n } };
}
async function openAccess(page: Page, once: Kho["once"] = {}): Promise<Kho> {
  await mockStudio(page, { session: true });
  const k = await mockH4b2(page, { once, entitlements });
  k.cells[ck(AG.hoadon, TN.acme)] = { grants: { group: 1, user: 1, tenant: 0 } };
  k.cells[ck(AG.assistant, TN.beta)] = { grants: { group: 0, user: 0, tenant: 0 } };
  await openAuthed(page, "/access");
  await expect(page.getByRole("heading", { name: "Quyền agent", exact: true })).toBeVisible();
  return k;
}
const matrix = (page: Page) => page.getByRole("table", { name: "Ma trận quyền agent" });
const sw = (page: Page, agent: string, tenant: string) =>
  matrix(page).getByRole("switch", { name: `${agent} × ${tenant}` });

test('HUB-FR-78 · M30 · menu "Quyền agent" là link ⇒ /studio/access; ma trận: ô đã cấp aria-checked true + "2 grant", chưa cấp false [artboard Access]', async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  const k = await mockH4b2(page, { entitlements });
  k.cells[ck(AG.hoadon, TN.acme)] = { grants: { group: 1, user: 1, tenant: 0 } };
  await openAuthed(page, "/agents");
  await page
    .getByRole("navigation", { name: "Menu Studio" })
    .getByRole("link", { name: "Quyền agent" })
    .click();
  await expect(page).toHaveURL(/\/studio\/access/);
  await expect(sw(page, "hoadon", "acme")).toHaveAttribute("aria-checked", "true");
  await expect(sw(page, "hoadon", "beta-co")).toHaveAttribute("aria-checked", "false");
  await expect(matrix(page)).toContainText("2 grant");
});

test('HUB-FR-78 · AC-H4b2-04 · M31 · bật ô chưa cấp ⇒ PUT /agent-entitlements/:agent/:tenant ngay (không xác nhận); switch bật; toast "Đã cấp" [D9]', async ({
  page,
}) => {
  const k = await openAccess(page);
  const put = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      r.url().endsWith(`/agent-entitlements/${AG.hoadon}/${TN.beta}`),
  );
  await sw(page, "hoadon", "beta-co").click();
  await put;
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(sw(page, "hoadon", "beta-co")).toHaveAttribute("aria-checked", "true");
  await expect(toast(page)).toContainText("Đã cấp");
  expect(writes(k).map((c) => c.method)).toEqual(["PUT"]);
});

test('HUB-FR-78 · AC-H4b2-05 · M32 · tắt ô có 2 grant ⇒ alertdialog "Thu hồi hoadon khỏi acme?" nêu "2 grant … sẽ mất hiệu lực"; Huỷ ⇒ không gửi; Thu hồi ⇒ DELETE, switch tắt [D9 · UI §9]', async ({
  page,
}) => {
  const k = await openAccess(page);
  await sw(page, "hoadon", "acme").click();
  const dlg = page.getByRole("alertdialog", { name: "Thu hồi hoadon khỏi acme?" });
  await expect(dlg).toContainText("2 grant trong tenant acme sẽ mất hiệu lực");
  await expect(dlg).toContainText("Run đang chạy vẫn xong.");
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await expect(dlg).toBeHidden();
  expect(writes(k)).toEqual([]);
  await expect(sw(page, "hoadon", "acme")).toHaveAttribute("aria-checked", "true");
  await sw(page, "hoadon", "acme").click();
  const del = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      r.url().endsWith(`/agent-entitlements/${AG.hoadon}/${TN.acme}`),
  );
  await page
    .getByRole("alertdialog", { name: "Thu hồi hoadon khỏi acme?" })
    .getByRole("button", { name: "Thu hồi" })
    .click();
  await del;
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(sw(page, "hoadon", "acme")).toHaveAttribute("aria-checked", "false");
  await expect(toast(page)).toContainText("Đã thu hồi");
});

test('HUB-FR-78 · M33 · "Chi tiết hoadon × acme" ⇒ drawer chỉ đọc: Ngày cấp, Người cấp padmin, grant Kế toán + lan; Đóng trả về ma trận', async ({
  page,
}) => {
  await openAccess(page);
  await matrix(page).getByRole("button", { name: "Chi tiết hoadon × acme" }).click();
  const dlg = page.getByRole("dialog", { name: "Chi tiết hoadon × acme" });
  await expect(dlg).toContainText("Ngày cấp");
  await expect(dlg).toContainText("padmin");
  await expect(dlg).toContainText("Kế toán");
  await expect(dlg).toContainText("lan");
  await expect(dlg.getByRole("switch")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Đóng" }).click();
  await expect(dlg).toBeHidden();
  await expect(matrix(page)).toBeVisible();
});

test('HUB-FR-78 · M34 · agent tắt (sales-report): cột/dòng ghi "Agent đang tắt", công tắc vẫn dùng được [D11]', async ({
  page,
}) => {
  await openAccess(page);
  await expect(matrix(page)).toContainText("Agent đang tắt");
  await expect(sw(page, "sales-report", "acme")).toBeEnabled();
});

test('HUB-FR-78 · M35 · PUT 409 ⇒ toast "Quyền vừa được thay đổi. Đã tải lại ma trận." + GET lại ma trận; switch hoàn về [D9 · D10]', async ({
  page,
}) => {
  const k = await openAccess(page, {
    [`PUT /agent-entitlements/${AG.assistant}/${TN.acme}`]: {
      status: 409,
      body: { error: { code: "VERSION_CONFLICT", message: "x" } },
    },
  });
  const gets0 = k.calls.filter(
    (c) => c.method === "GET" && c.path === "/agent-entitlements",
  ).length;
  await sw(page, "assistant", "acme").click();
  await expect(toast(page)).toContainText("Quyền vừa được thay đổi. Đã tải lại ma trận.");
  await expect(sw(page, "assistant", "acme")).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(
      () => k.calls.filter((c) => c.method === "GET" && c.path === "/agent-entitlements").length,
    )
    .toBeGreaterThan(gets0);
});

test('HUB-FR-78 · M36 · lọc "Lọc theo agent" = hoadon ⇒ chỉ còn dòng hoadon', async ({ page }) => {
  await openAccess(page);
  const f = page.getByRole("combobox", { name: "Lọc theo agent" });
  const tag = await f.evaluate((e) => e.tagName.toLowerCase());
  if (tag === "select") await f.selectOption({ label: "hoadon" });
  else {
    await f.click();
    await page.getByRole("option", { name: /hoadon/ }).click();
  }
  await expect(sw(page, "hoadon", "acme")).toBeVisible();
  await expect(sw(page, "assistant", "acme")).toHaveCount(0);
});

test('HUB-BR-17 · AC-H4b2-06 · M37 · tenant_admin mở /studio/access ⇒ "Bạn không có quyền vào Agent Forge"; không gọi /agent-entitlements (khoá hồi quy, có thể xanh trước code) [spec §2]', async ({
  page,
}) => {
  const s = await mockStudio(page, { role: "tenant_admin" });
  await page.goto("/studio/access");
  await login(page, "tadmin", "acme");
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền vào Agent Forge" }),
  ).toBeVisible();
  await expect(matrix(page)).toHaveCount(0);
  expect(s.calls.filter((c) => c.path.startsWith("/agent-entitlements"))).toEqual([]);
});

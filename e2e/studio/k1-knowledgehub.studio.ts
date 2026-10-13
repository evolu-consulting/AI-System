// HUB-FR-131 · HUB-FR-132 · HUB-BR-35 · HUB-BR-40 · K1-AC01 (vế UI) · plan-frontend K1 §2–§5 (nhãn VI nguyên văn) · spec §3.2 ·
// test-plan K1 §4 E01–E13: Studio → Cài đặt → KnowledgeHub (URL + allowlist, bảng tenant ↔ namespace, Sheet tenant chọn secret
// `kh_api_key` của chính tenant + project, Dialog kết quả kiểm) + Switch "Tri thức" trong editor agent. API giả lập bằng
// `page.route` (mẫu H4a/H4b-1): `mockStudio` lo /auth + /me + agents + tenants; route KH đăng ký SAU nên được ưu tiên.
// Đỏ trước code: `/settings` chưa có ⇒ không thấy heading "Cài đặt".
import { expect, type Page, test } from "@playwright/test";
import { AT, check, err, type Kh, k, mockKh, ORIGIN, SEC } from "./_k1-kh";
import { ID, mockStudio, openAuthed, seedStore } from "./_support";

async function open(page: Page, o: Partial<Kh> = {}): Promise<Kh> {
  await mockStudio(page, { session: true });
  const st = await mockKh(page, o);
  await openAuthed(page, "/settings");
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  return st;
}
const table = (p: Page) => p.getByRole("table", { name: "Tenant ↔ namespace" });
const writes = (st: Kh) => st.calls.filter((x) => x.method !== "GET");

test("HUB-FR-131 · E01 · Cài đặt: tab KnowledgeHub, ô 'Địa chỉ KnowledgeHub', list 'Origin được phép', note embedder đa ngữ", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("tab", { name: "KnowledgeHub" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Địa chỉ KnowledgeHub" })).toHaveValue(ORIGIN);
  await expect(page.getByRole("list", { name: "Origin được phép" })).toContainText(ORIGIN);
  await expect(page.getByRole("note").filter({ hasText: "embedder đa ngữ" })).toBeVisible();
});

test("HUB-FR-131 · E02 · lưu URL khi chưa có tenant ⇒ PUT {base_url, version}, toast 'Đã lưu địa chỉ KnowledgeHub'", async ({
  page,
}) => {
  const st = await open(page, {
    tenants: [],
    settings: {
      base_url: null,
      allowed_origins: [ORIGIN],
      timeout_ms: 5000,
      version: 3,
      updated_at: AT,
    },
  });
  await page.getByRole("textbox", { name: "Địa chỉ KnowledgeHub" }).fill(ORIGIN);
  const put = page.waitForRequest((r) => r.method() === "PUT" && /\/kh\/settings$/.test(r.url()));
  await page.getByRole("button", { name: "Lưu", exact: true }).first().click();
  expect((await put).postDataJSON()).toEqual({ base_url: ORIGIN, version: 3 });
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(
    "Đã lưu địa chỉ KnowledgeHub",
  );
  expect(writes(st)).toHaveLength(1);
});

test("HUB-FR-131 · Q5 · E03 · đổi URL khi đã có tenant ⇒ hộp xác nhận 'Đổi địa chỉ sẽ đặt mọi tenant về Chưa kiểm tra.' trước khi gửi", async ({
  page,
}) => {
  const st = await open(page);
  await page.getByRole("textbox", { name: "Địa chỉ KnowledgeHub" }).fill(`${ORIGIN}/v2`);
  await page.getByRole("button", { name: "Lưu", exact: true }).first().click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Đổi địa chỉ sẽ đặt mọi tenant về Chưa kiểm tra.");
  expect(writes(st)).toEqual([]);
  const put = page.waitForRequest((r) => r.method() === "PUT" && /\/kh\/settings$/.test(r.url()));
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await put).postDataJSON()).toMatchObject({ base_url: `${ORIGIN}/v2` });
});

test("HUB-BR-37 · E04 · 422 KH_URL_NOT_ALLOWED not_in_allowlist ⇒ 'Origin này không nằm trong danh sách được phép'; allowlist rỗng ⇒ Alert vận hành", async ({
  page,
}) => {
  await open(page, {
    tenants: [],
    once: {
      "PUT /kh/settings": {
        status: 422,
        body: err("KH_URL_NOT_ALLOWED", { reason: "not_in_allowlist" }),
      },
    },
  });
  await page
    .getByRole("textbox", { name: "Địa chỉ KnowledgeHub" })
    .fill("https://evil.example.com");
  await page.getByRole("button", { name: "Lưu", exact: true }).first().click();
  await expect(page.getByText("Origin này không nằm trong danh sách được phép")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await open(page, {
    settings: { base_url: null, allowed_origins: [], timeout_ms: 5000, version: 1, updated_at: AT },
    tenants: [],
  });
  await expect(
    page.getByText("Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ"),
  ).toBeVisible();
});

test("HUB-FR-131 · E05 · bảng 'Tenant ↔ namespace': dòng Acme Corp (acme_ns, kh-acme, Đạt, Bật) + nút theo tên tenant", async ({
  page,
}) => {
  await open(page);
  const row = table(page).getByRole("row").filter({ hasText: "Acme Corp" });
  await expect(row).toContainText("acme_ns");
  await expect(row).toContainText("kh-acme");
  await expect(row).toContainText("Đạt");
  await expect(row).toContainText("Bật");
  for (const b of ["Kiểm tra Acme Corp", "Kết quả Acme Corp", "Sửa Acme Corp", "Xoá Acme Corp"])
    await expect(page.getByRole("button", { name: b })).toBeVisible();
});

test("HUB-BR-40 · Q2 · K1-AC01 · E06 · Kiểm tra ⇒ dialog 'Kết quả kiểm tra': 'Kết nối chưa đạt: 1 lỗi' + câu people lanes dùng chung + cảnh báo embedder", async ({
  page,
}) => {
  await open(page, {
    checkResult: check("error", [
      { code: "kh_people_lanes_on_shared", level: "error", params: { project_id: "proj-shared" } },
    ]),
  });
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/kh\/tenants\/[^/]+\/check$/.test(r.url()),
  );
  await page.getByRole("button", { name: "Kiểm tra Acme Corp" }).click();
  await post;
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối chưa đạt: 1 lỗi");
  await expect(dlg.getByRole("list")).toContainText(
    "Namespace bật include_people_lanes nhưng project dùng chung proj-shared phải tắt — hãy tắt phía KnowledgeHub hoặc bỏ đánh dấu dùng chung",
  );
  await expect(dlg.getByRole("list")).toContainText(
    "Cần embedder đa ngữ (ví dụ bge-m3) để tìm tiếng Việt chính xác.",
  );
});

test("HUB-FR-131 · K1-AC01 · E07 · Kiểm tra đạt ⇒ 'Kết nối đạt' + 'Phiên bản KnowledgeHub: v6.4'; kind=local ⇒ câu kh_auth_disabled", async ({
  page,
}) => {
  const st = await open(page);
  await page.getByRole("button", { name: "Kiểm tra Acme Corp" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối đạt");
  await expect(dlg).toContainText("Phiên bản KnowledgeHub: v6.4");
  await page.keyboard.press("Escape");
  st.checkResult = check("error", [{ code: "kh_auth_disabled", level: "error" }]);
  await page.getByRole("button", { name: "Kiểm tra Acme Corp" }).click();
  await expect(page.getByRole("dialog", { name: "Kết quả kiểm tra" })).toContainText(
    "KnowledgeHub trả lời khi không có token hoặc khoá là loại local — hãy bật xác thực và dùng client credentials",
  );
});

async function openAdd(page: Page) {
  await page.getByRole("button", { name: "Thêm tenant" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm tenant" });
  await dlg.getByRole("combobox", { name: "Tenant" }).click();
  await page.getByRole("option", { name: "Beta Ltd", exact: true }).click();
  return dlg;
}

test("HUB-FR-131 · HUB-BR-35 · E08 · Thêm tenant: chọn Beta Ltd, ns, secret kh-beta (chỉ secret của tenant), project ⇒ PUT không version; 'Đã lưu · v1'", async ({
  page,
}) => {
  await open(page);
  const dlg = await openAdd(page);
  await dlg.getByRole("textbox", { name: "Namespace" }).fill("beta_ns");
  await dlg.getByRole("combobox", { name: "Secret KnowledgeHub" }).click();
  await expect(page.getByRole("option", { name: "kh-acme" })).toHaveCount(0);
  await page.getByRole("option", { name: "kh-beta" }).click();
  await expect(dlg.getByRole("textbox", { name: "Keyspace" })).toHaveValue("step");
  await dlg.getByRole("button", { name: "Thêm project" }).click();
  const grp = dlg.getByRole("group", { name: "Project" });
  await grp.getByRole("textbox", { name: "Mã project" }).fill("proj-beta");
  await grp.getByRole("textbox", { name: "Nhãn" }).fill("Dự án Beta");
  const put = page.waitForRequest((r) => r.method() === "PUT" && /\/kh\/tenants\//.test(r.url()));
  await dlg.getByRole("button", { name: "Lưu" }).click();
  const req = await put;
  expect(new URL(req.url()).pathname.endsWith(`/kh/tenants/${ID.beta}`)).toBe(true);
  expect(req.postDataJSON()).toEqual({
    ns: "beta_ns",
    secret_id: SEC.beta,
    keyspace: "step",
    projects: [{ project_id: "proj-beta", label: "Dự án Beta", read_only: false }],
  });
  await expect(dlg.getByRole("status")).toContainText("Đã lưu · v1");
});

test("HUB-BR-35 · E09 · namespace 'khx' ⇒ 'Namespace không được bắt đầu bằng kh hoặc trùng tên dành riêng', không PUT", async ({
  page,
}) => {
  const st = await open(page);
  const dlg = await openAdd(page);
  await dlg.getByRole("textbox", { name: "Namespace" }).fill("khx");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Namespace không được bắt đầu bằng kh hoặc trùng tên dành riêng");
  expect(writes(st)).toEqual([]);
});

test("HUB-FR-131 · E10 · lỗi server: KH_SECRET_INVALID ⇒ câu tiếng Việt; KH_PROJECT_IN_USE ⇒ liệt kê quy trình", async ({
  page,
}) => {
  const st = await open(page, {
    once: {
      [`PUT /kh/tenants/${ID.beta}`]: {
        status: 422,
        body: err("KH_SECRET_INVALID", { reason: "wrong_tenant" }),
      },
    },
  });
  const dlg = await openAdd(page);
  await dlg.getByRole("textbox", { name: "Namespace" }).fill("beta_ns");
  await dlg.getByRole("combobox", { name: "Secret KnowledgeHub" }).click();
  await page.getByRole("option", { name: "kh-beta" }).click();
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Secret phải là khoá KnowledgeHub của chính tenant này");
  st.once[`PUT /kh/tenants/${ID.beta}`] = {
    status: 409,
    body: err("KH_PROJECT_IN_USE", {
      project_id: "proj-b",
      process_defs: [{ id: k(50), key: "k1-free", name: "K1 tự do" }],
    }),
  };
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Project còn được gắn cho quy trình: K1 tự do");
});

test("HUB-FR-131 · Q7 · E11 · tenant chưa có secret KnowledgeHub ⇒ 'Tenant này chưa có secret KnowledgeHub' + link 'Tạo secret'; không có 'Toàn nền tảng'", async ({
  page,
}) => {
  await open(page, { secrets: { [ID.acme]: [{ id: SEC.acme, name: "kh-acme" }] } });
  const dlg = await openAdd(page);
  await expect(dlg).toContainText("Tenant này chưa có secret KnowledgeHub");
  await expect(dlg.getByRole("link", { name: "Tạo secret" })).toBeVisible();
  await expect(page.getByText("Toàn nền tảng")).toHaveCount(0);
});

test("HUB-FR-131 · D16 · E12 · Xoá Acme Corp ⇒ xác nhận 'Xoá cấu hình KnowledgeHub của Acme Corp?' ⇒ DELETE ?version=1", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Xoá Acme Corp" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Xoá cấu hình KnowledgeHub của Acme Corp?");
  await expect(dlg).toContainText("Secret không bị xoá.");
  const del = page.waitForRequest((r) => r.method() === "DELETE");
  await dlg.getByRole("button", { name: "Xoá" }).click();
  const u = new URL((await del).url());
  expect([u.pathname.endsWith(`/kh/tenants/${ID.acme}`), u.searchParams.get("version")]).toEqual([
    true,
    "1",
  ]);
});

test("HUB-FR-132 · D5 · E13 · agent CLI: switch 'Được dùng tri thức (KnowledgeHub)' ⇒ PUT /agents/:id/knowledge {knowledge_enabled, version}; agent llm ⇒ disabled", async ({
  page,
}) => {
  const store = seedStore();
  for (const a of store.agents) a.knowledge_enabled = false;
  await mockStudio(page, { session: true, store });
  await mockKh(page);
  const puts: Record<string, unknown>[] = [];
  await page.route(/\/studio\/api\/agents\/[^/]+\/knowledge$/, async (route) => {
    puts.push(route.request().postDataJSON() as Record<string, unknown>);
    const a = store.agents.find((x) => x.id === ID.hoadon);
    return route.fulfill({
      status: 200,
      json: { agent: { ...a, knowledge_enabled: true, version: 2 }, hub_config_version: 8 },
    });
  });
  await openAuthed(page, `/agents/${ID.hoadon}`);
  const sw = page.getByRole("switch", { name: "Được dùng tri thức (KnowledgeHub)" });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  expect(puts).toEqual([{ knowledge_enabled: true, version: 1 }]);
  await openAuthed(page, `/agents/${ID.helper}`);
  await expect(
    page.getByRole("switch", { name: "Được dùng tri thức (KnowledgeHub)" }),
  ).toBeDisabled();
  await expect(page.getByText("Chỉ agent chạy bằng CLI mới dùng được tri thức")).toBeVisible();
});

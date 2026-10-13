// HUB-FR-68 · HUB-FR-69 · HUB-BR-30 · AC-H4b1-08 (+ vế UI AC-01, 03, 04) · plan-frontend §2–§5 (nhãn VI nguyên văn) · spec §3 A
// · test-plan H4b1 §3 E01–E13: Studio → Secrets. API giả lập bằng `page.route` (mẫu H4a): `mockStudio` lo /auth + /me,
// route `/studio/api/secrets*` đăng ký SAU nên được ưu tiên. Giá trị chỉ ghi: không nút xem, ô rỗng lại sau lưu, DOM/URL/
// storage không chứa giá trị. Đỏ trước code: `/studio/secrets` chưa có ⇒ không thấy heading/tab/nút.
import { expect, type Page, test } from "@playwright/test";
import { ID, login, mockStudio, openAuthed } from "./_support";

const s = (n: number) => `e4b10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-13T08:00:00.000Z";
type Item = {
  id: string;
  kind: string;
  tenant: { id: string; key: string; name: string } | null;
  name: string;
  version: number;
  used_by: { type: string; id: string; key: string }[];
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};
const item = (id: string, kind: string, name: string, o: Partial<Item> = {}): Item => ({
  id,
  kind,
  tenant: null,
  name,
  version: 1,
  used_by: [],
  created_at: AT,
  updated_at: AT,
  updated_by: "padmin",
  ...o,
});
const ACME = { id: ID.acme, key: "acme", name: "Acme Corp" };
const seed = (): Item[] => [
  item(s(1), "provider_api_key", "anth-main", {
    used_by: [{ type: "provider", id: s(90), key: "anth-api" }],
  }),
  item(s(2), "provider_api_key", "openai-main"),
  item(s(3), "source_credential", "git-acme", { tenant: ACME }),
];
type Call = {
  method: string;
  path: string;
  query: string;
  body: Record<string, unknown> | undefined;
};
type Sec = {
  items: Item[];
  calls: Call[];
  once: Record<string, { status: number; body: unknown }>;
};
const err = (code: string, details?: unknown) => ({
  error: { code, message: code, ...(details ? { details } : {}) },
});

/** Mock `/studio/api/secrets*` theo contract spec §3 A (đăng ký sau `mockStudio` ⇒ ưu tiên). */
async function mockSecrets(
  page: Page,
  o: { items?: Item[]; once?: Sec["once"] } = {},
): Promise<Sec> {
  const st: Sec = { items: o.items ?? seed(), calls: [], once: { ...(o.once ?? {}) } };
  await page.route(/\/studio\/api\/secrets(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/studio\/api/, "");
    const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : undefined;
    st.calls.push({ method: req.method(), path, query: url.search, body });
    const key = `${req.method()} ${path}`;
    const one = st.once[key];
    if (one) {
      delete st.once[key];
      return route.fulfill({ status: one.status, json: one.body });
    }
    const sid = path.split("/")[2];
    const it = st.items.find((i) => i.id === sid);
    if (req.method() === "GET" && !sid) {
      const kind = url.searchParams.get("kind");
      const items = st.items.filter((i) => !kind || i.kind === kind);
      return route.fulfill({ status: 200, json: { items, next_cursor: null } });
    }
    if (req.method() === "POST") {
      const n = item(s(100 + st.items.length), String(body?.kind), String(body?.name));
      st.items.push(n);
      return route.fulfill({ status: 201, json: n });
    }
    if (!it) return route.fulfill({ status: 404, json: err("NOT_FOUND") });
    if (req.method() === "GET") return route.fulfill({ status: 200, json: it });
    if (req.method() === "PUT") {
      it.version += 1;
      return route.fulfill({ status: 200, json: it });
    }
    st.items = st.items.filter((i) => i !== it);
    return route.fulfill({ status: 204, body: "" });
  });
  return st;
}
async function open(page: Page, o: Parameters<typeof mockSecrets>[1] = {}, path = "/secrets") {
  await mockStudio(page, { session: true });
  const st = await mockSecrets(page, o);
  await openAuthed(page, path);
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible();
  return st;
}
const table = (page: Page) => page.getByRole("table", { name: "Danh sách secret" });
const row = (page: Page, name: string) => table(page).getByRole("row").filter({ hasText: name });
const toast = (page: Page) => page.getByRole("region", { name: "Notifications" });
const writes = (st: Sec) => st.calls.filter((c) => c.method !== "GET");
/** Không nơi nào trên trang (DOM, URL, storage) chứa giá trị. */
async function expectNowhere(page: Page, v: string) {
  expect(await page.content()).not.toContain(v);
  expect(page.url()).not.toContain(v);
  const store = await page.evaluate(
    () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  );
  expect(store).not.toContain(v);
}

test('HUB-FR-68 · E01 · menu "Secrets" là link (không còn Sắp có) ⇒ /studio/secrets, heading "Secrets" [plan-frontend §5]', async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await mockSecrets(page);
  await openAuthed(page, "/agents");
  const nav = page.getByRole("navigation", { name: "Menu Studio" });
  await nav.getByRole("link", { name: "Secrets" }).click();
  await expect(page).toHaveURL(/\/studio\/secrets/);
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: "Secrets" })).toHaveCount(0);
});

test('HUB-FR-68 · AC-H4b1-01 · E02 · 3 tab; tab Provider mặc định: dòng có "Đã lưu", Được dùng bởi, [Thay giá trị] [Xoá]; không nút xem giá trị [plan-frontend D3]', async ({
  page,
}) => {
  await open(page);
  const tabs = page.getByRole("tablist", { name: "Loại secret" });
  for (const t of ["Provider API key", "Khoá nguồn (git)", "Khoá KnowledgeHub"])
    await expect(tabs.getByRole("tab", { name: t })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Provider API key" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(row(page, "anth-main")).toContainText("Đã lưu");
  await expect(row(page, "anth-main")).toContainText("Provider · anth-api");
  await expect(row(page, "openai-main")).toContainText("Chưa dùng");
  await expect(row(page, "git-acme")).toHaveCount(0);
  await expect(row(page, "anth-main").getByRole("button", { name: "Thay giá trị" })).toBeVisible();
  await expect(row(page, "anth-main").getByRole("button", { name: "Xoá" })).toBeVisible();
  await expect(table(page).getByRole("button", { name: /Xem|Hiện/ })).toHaveCount(0);
});

test('HUB-FR-68 · AC-H4b1-08 · E03 · Thêm provider key: nhập trong SecretField, Lưu ⇒ POST đúng thân; Sheet ở lại "Đã lưu · v1" + [Đóng]; ô giá trị rỗng lại; không nơi nào chứa giá trị', async ({
  page,
}) => {
  const st = await open(page);
  const V = "sk-ant-qc-E03-Zx9Pq7Lm-secret";
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm secret" });
  await dlg.getByRole("textbox", { name: "Tên" }).fill("anthropic-main");
  const field = dlg.getByLabel("Giá trị", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(V);
  await expect(dlg.getByRole("button", { name: "Hiện giá trị đang gõ" })).toBeVisible();
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/studio\/api\/secrets$/.test(r.url()),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await post).postDataJSON()).toEqual({
    kind: "provider_api_key",
    name: "anthropic-main",
    value: V,
  });
  await expect(dlg.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Đóng" })).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(toast(page)).toContainText("Đã thêm anthropic-main");
  await expect(row(page, "anthropic-main")).toContainText("Đã lưu");
  await expectNowhere(page, V);
  expect(writes(st).length).toBe(1);
});

test('HUB-FR-69 · AC-H4b1-03 · E04 · Thay giá trị: Sheet "Thay giá trị · openai-main", ô rỗng (không điền sẵn), tên không sửa; Lưu ⇒ PUT {version 1, value} ⇒ "Đã lưu · v2"', async ({
  page,
}) => {
  const st = await open(page);
  const V = "sk-openai-qc-E04-Zx9Pq7Lm";
  await row(page, "openai-main").getByRole("button", { name: "Thay giá trị" }).click();
  const dlg = page.getByRole("dialog", { name: "Thay giá trị · openai-main" });
  await expect(dlg.getByRole("textbox", { name: "Tên" })).toHaveCount(0);
  const field = dlg.getByLabel("Giá trị", { exact: true });
  await expect(field).toHaveValue("");
  await field.fill(V);
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().includes(`/studio/api/secrets/${s(2)}`),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await put).postDataJSON()).toEqual({ version: 1, value: V });
  await expect(dlg.getByRole("status").filter({ hasText: "Đã lưu · v2" })).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(toast(page)).toContainText("Đã thay giá trị openai-main");
  await expectNowhere(page, V);
  expect(writes(st).map((c) => c.method)).toEqual(["PUT"]);
});

test('HUB-FR-68 · AC-H4b1-04 · E05 · Xoá secret chưa dùng: alertdialog "Xoá openai-main?" ⇒ DELETE ?version=1, dòng biến mất', async ({
  page,
}) => {
  const st = await open(page);
  await row(page, "openai-main").getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Xoá openai-main?" });
  await expect(dlg).toContainText("Giá trị sẽ bị xoá vĩnh viễn và không khôi phục được.");
  const del = page.waitForRequest((r) => r.method() === "DELETE");
  await dlg.getByRole("button", { name: "Xoá" }).click();
  const u = new URL((await del).url());
  expect([u.pathname.endsWith(`/secrets/${s(2)}`), u.searchParams.get("version")]).toEqual([
    true,
    "1",
  ]);
  await expect(row(page, "openai-main")).toHaveCount(0);
  await expect(toast(page)).toContainText("Đã xoá openai-main");
  expect(writes(st).length).toBe(1);
});

test('HUB-FR-68 · AC-H4b1-04 · E06 · Xoá secret đang dùng (used_by ≠ rỗng) ⇒ "Không xoá được anth-main" liệt kê Provider · anth-api; không gửi DELETE', async ({
  page,
}) => {
  const st = await open(page);
  await row(page, "anth-main").getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Không xoá được anth-main" });
  await expect(dlg).toContainText("Provider · anth-api");
  await dlg.getByRole("button", { name: "Đóng" }).click();
  await expect(dlg).toBeHidden();
  expect(writes(st)).toEqual([]);
});

test('HUB-FR-68 · AC-H4b1-04 · E07 · server trả 409 SECRET_IN_USE {used_by} ⇒ hộp "Không xoá được openai-main" liệt kê nơi dùng', async ({
  page,
}) => {
  await open(page, {
    once: {
      [`DELETE /secrets/${s(2)}`]: {
        status: 409,
        body: err("SECRET_IN_USE", {
          used_by: [{ type: "provider", id: s(91), key: "openai-api" }],
        }),
      },
    },
  });
  await expect(table(page)).toBeVisible();
  await expect(row(page, "openai-main")).toHaveCount(1);
  await row(page, "openai-main").getByRole("button", { name: "Xoá" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Xoá openai-main?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Không xoá được openai-main" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Provider · openai-api");
  await expect(row(page, "openai-main")).toHaveCount(1);
});

test('HUB-FR-69 · AC-H4b1-03 · E08 · PUT 409 VERSION_CONFLICT ⇒ "Có người vừa lưu bản mới hơn" (không "Xem khác biệt"); [Ghi đè] gửi lại cùng giá trị với version mới', async ({
  page,
}) => {
  const cur = item(s(2), "provider_api_key", "openai-main", { version: 3 });
  const st = await open(page, {
    once: {
      [`PUT /secrets/${s(2)}`]: {
        status: 409,
        body: err("VERSION_CONFLICT", { current: cur, updated_at: AT }),
      },
    },
  });
  const V = "sk-openai-qc-E08-Zx9Pq7Lm";
  await expect(row(page, "openai-main")).toHaveCount(1);
  await row(page, "openai-main").getByRole("button", { name: "Thay giá trị" }).click();
  const sheet = page.getByRole("dialog", { name: "Thay giá trị · openai-main" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Giá trị", { exact: true })).toHaveAttribute("type", "password");
  await sheet.getByLabel("Giá trị", { exact: true }).fill(V);
  await sheet.getByRole("button", { name: "Lưu" }).click();
  const cf = page.getByRole("alertdialog", { name: "Có người vừa lưu bản mới hơn" });
  await expect(cf).toBeVisible();
  await expect(cf.getByRole("button", { name: "Tải bản mới" })).toBeVisible();
  await expect(cf.getByRole("button", { name: "Ghi đè" })).toBeVisible();
  await expect(cf.getByRole("button", { name: "Xem khác biệt" })).toHaveCount(0);
  const again = page.waitForRequest((r) => r.method() === "PUT");
  await cf.getByRole("button", { name: "Ghi đè" }).click();
  expect((await again).postDataJSON()).toEqual({ version: 3, value: V });
  expect(st.calls.filter((c) => c.method === "PUT").length).toBe(2);
});

test('HUB-FR-68 · CR-060 · Q1 · E09 · tab "Khoá nguồn (git)": ?kind=source_credential, cột Tenant (acme), không nút + Thêm secret, có chú thích màn Nguồn', async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("tablist", { name: "Loại secret" })
    .getByRole("tab", { name: "Khoá nguồn (git)" })
    .click();
  await expect(page).toHaveURL(/kind=source_credential/);
  await expect(table(page).getByRole("columnheader", { name: "Tenant" })).toBeVisible();
  await expect(row(page, "git-acme")).toContainText("acme");
  await expect(row(page, "anth-main")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Thêm secret" })).toHaveCount(0);
  await expect(
    page.getByText("Khoá nguồn do tenant admin tạo ở màn Nguồn.", { exact: false }).first(),
  ).toBeVisible();
});

test('HUB-FR-68 · Q4 · E10 · validate client: trống ⇒ "Nhập tên secret" + "Nhập giá trị secret"; tên `a` + giá trị 7 ký tự ⇒ câu lỗi regex/độ dài; không POST', async ({
  page,
}) => {
  const st = await open(page);
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm secret" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("textbox", { name: "Tên" })).toBeVisible();
  await expect(dlg.getByLabel("Giá trị", { exact: true })).toBeVisible();
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Nhập tên secret");
  await expect(dlg).toContainText("Nhập giá trị secret");
  await dlg.getByRole("textbox", { name: "Tên" }).fill("a");
  await dlg.getByLabel("Giá trị", { exact: true }).fill("1234567");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Chỉ dùng chữ, số, - và _ (2–64 ký tự)");
  await expect(dlg).toContainText("Giá trị dài 8–2048 ký tự");
  expect(writes(st)).toEqual([]);
});

test('HUB-FR-68 · Q4 · E11 · server 409 SECRET_NAME_TAKEN ⇒ lỗi dưới Tên "Tên này đã được dùng cho loại secret này"; Sheet giữ mở', async ({
  page,
}) => {
  await open(page, { once: { "POST /secrets": { status: 409, body: err("SECRET_NAME_TAKEN") } } });
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm secret" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("textbox", { name: "Tên" }).fill("Anth-Main");
  await dlg.getByLabel("Giá trị", { exact: true }).fill("sk-qc-E11-Zx9Pq7Lm");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Tên này đã được dùng cho loại secret này");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("textbox", { name: "Tên" })).toHaveValue("Anth-Main");
});

test('HUB-FR-68 · Q7 · E12 · tab "Khoá KnowledgeHub" rỗng ⇒ "Chưa có khoá KnowledgeHub."; + Thêm secret ⇒ POST kind kh_api_key', async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("tablist", { name: "Loại secret" })
    .getByRole("tab", { name: "Khoá KnowledgeHub" })
    .click();
  await expect(page.getByText("Chưa có khoá KnowledgeHub.")).toBeVisible();
  await page.getByRole("button", { name: "+ Thêm secret" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Thêm secret" });
  await expect(dlg.getByRole("combobox", { name: "Phạm vi" })).toBeVisible();
  await dlg.getByRole("textbox", { name: "Tên" }).fill("kh-main");
  await dlg
    .getByLabel("Giá trị", { exact: true })
    .fill('{"client_id":"kh-ns","client_secret":"QcE12-xyz"}');
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/studio\/api\/secrets$/.test(r.url()),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await post).postDataJSON()).toMatchObject({ kind: "kh_api_key", name: "kh-main" });
  await expect(dlg.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await expectNowhere(page, "QcE12-xyz");
});

test('HUB-FR-68 · E13 · tenant_admin mở /studio/secrets rồi đăng nhập ⇒ /forbidden "Bạn không có quyền vào Agent Forge"; không gọi /studio/api/secrets [H4a E03]', async ({
  page,
}) => {
  await mockStudio(page, { role: "tenant_admin" });
  const st = await mockSecrets(page);
  await page.goto("/studio/secrets");
  await login(page, "tadmin", "acme");
  await expect(page).toHaveURL(/\/studio\/forbidden/);
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền vào Agent Forge" }),
  ).toBeVisible();
  expect(st.calls).toEqual([]);
});

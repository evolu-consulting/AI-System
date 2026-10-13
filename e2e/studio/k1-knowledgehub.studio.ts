// HUB-FR-131 · HUB-FR-132 · HUB-BR-37 · HUB-BR-40 · K1-AC01 (vế UI) · CR-073 · mockup https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ ·
// plan-frontend K1 §2–§5 (nhãn VI nguyên văn) · spec §3.2 · test-plan K1 §4 E01–E12: Studio → Cài đặt → bảng "Kết nối
// KnowledgeHub" (cột, note rủi ro, origin), Sheet Thêm/Sửa (Tên, Địa chỉ, Khoá = secret nền tảng, Project ghi Tóm tắt), Dialog
// "Kết quả kiểm tra", xoá (alertdialog), section "KnowledgeHub" trong Sửa agent (tick kết nối theo thứ tự, ≤ 5, chỉ CLI).
// API giả lập bằng `page.route` (mẫu H4a/H4b-1): `mockStudio` lo /auth + /me + agents; route KH đăng ký SAU nên được ưu tiên.
// Đỏ trước code: `/settings` chưa có ⇒ không thấy heading "Cài đặt".
import { expect, type Page, test } from "@playwright/test";
import {
  ALT,
  CID,
  check,
  conn,
  err,
  type Kh,
  k,
  MAIN,
  mockKh,
  ORIGIN,
  ORIGIN2,
  SEC,
} from "./_k1-kh";
import { ID, mockStudio, openAuthed, seedStore } from "./_support";

async function open(page: Page, o: Partial<Kh> = {}): Promise<Kh> {
  await mockStudio(page, { session: true });
  const st = await mockKh(page, o);
  await openAuthed(page, "/settings");
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  return st;
}
const table = (p: Page) => p.getByRole("table", { name: "Kết nối KnowledgeHub" });
const writes = (st: Kh) => st.calls.filter((x) => x.method !== "GET");
const toast = (p: Page) => p.getByRole("region", { name: "Notifications" });
async function pickKey(p: Page, name: string): Promise<void> {
  await p.getByRole("dialog").getByRole("combobox", { name: "Khoá" }).click();
  await p.getByRole("option", { name }).click();
}

test("HUB-FR-131 · E01 · Cài đặt: heading + bảng 'Kết nối KnowledgeHub' (6 cột, dòng có tên/địa chỉ/khoá/project/badge/agent dùng), note rủi ro CR-073, 'Origin được phép'", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Kết nối KnowledgeHub" })).toBeVisible();
  for (const h of ["Tên", "Địa chỉ", "Khoá", "Project ghi Tóm tắt", "Trạng thái", "Agent dùng"])
    await expect(table(page).getByRole("columnheader", { name: h })).toBeVisible();
  const main = table(page).getByRole("row").filter({ hasText: "kh-main" });
  for (const t of [ORIGIN, "kh-key-main", "proj-a", "Đạt"]) await expect(main).toContainText(t);
  const alt = table(page).getByRole("row").filter({ hasText: "kh-alt" });
  await expect(alt).toContainText("Chưa kiểm tra");
  await expect(alt).toContainText("—");
  await expect(
    page
      .getByRole("note")
      .filter({ hasText: "Agent đọc được mọi project mà khoá của kết nối thấy" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Origin được phép" })).toContainText(ORIGIN2);
  for (const a of ["Kiểm tra", "Sửa", "Xoá"])
    await expect(page.getByRole("button", { name: `${a} kh-main` })).toBeVisible();
});

test("HUB-FR-131 · E02 · rỗng ⇒ 'Chưa có kết nối KnowledgeHub' + 'Thêm kết nối'; allowed_origins rỗng ⇒ Alert vận hành", async ({
  page,
}) => {
  await open(page, { items: [], allowed_origins: [] });
  await expect(page.getByText("Chưa có kết nối KnowledgeHub")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm kết nối" }).first()).toBeVisible();
  await expect(
    page.getByText("Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ"),
  ).toBeVisible();
});

test("HUB-FR-131 · E03 · Thêm kết nối: Sheet (Tên, Địa chỉ, Khoá, Project ghi Tóm tắt) ⇒ POST đúng body; project trống ⇒ null; toast 'Đã lưu kết nối kh-new'", async ({
  page,
}) => {
  const st = await open(page, { items: [] });
  await page.getByRole("button", { name: "Thêm kết nối" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Thêm kết nối" });
  await dlg.getByRole("textbox", { name: "Tên" }).fill("kh-new");
  await dlg.getByRole("textbox", { name: "Địa chỉ" }).fill(ORIGIN);
  await pickKey(page, "kh-key-main");
  await expect(dlg.getByRole("link", { name: "Tạo secret" })).toHaveAttribute("href", /\/secrets/);
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/kh\/connections$/.test(r.url()),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await post).postDataJSON()).toEqual({
    name: "kh-new",
    base_url: ORIGIN,
    secret_id: SEC.main,
    summary_project: null,
  });
  await expect(toast(page)).toContainText("Đã lưu kết nối kh-new");
  await expect(dlg.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await dlg.getByRole("button", { name: "Đóng" }).click();
  await expect(dlg).toBeHidden();
  await expect(table(page)).toContainText("kh-new");
  expect(writes(st)).toHaveLength(1);
});

test("HUB-BR-37 · E04 · validate client: tên có '/', địa chỉ http ngoài localhost, project sai ⇒ câu lỗi plan-frontend §3, không gửi", async ({
  page,
}) => {
  const st = await open(page);
  await page.getByRole("button", { name: "Thêm kết nối" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Thêm kết nối" });
  await dlg.getByRole("textbox", { name: "Tên" }).fill("a/b");
  await dlg.getByRole("textbox", { name: "Địa chỉ" }).fill("http://kh.example.com");
  await dlg.getByRole("textbox", { name: "Project ghi Tóm tắt" }).fill("a/b");
  await pickKey(page, "kh-key-main");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Nhập tên (tối đa 80 ký tự, không chứa /)");
  await expect(dlg).toContainText("Chỉ chấp nhận https:// (trừ localhost khi phát triển)");
  await expect(dlg).toContainText("Mã project không hợp lệ");
  expect(writes(st)).toEqual([]);
});

test("HUB-FR-131 · E05 · lỗi server theo trường: KH_CONNECTION_EXISTS / KH_SECRET_INVALID / KH_URL_NOT_ALLOWED ⇒ câu plan-frontend §4, Sheet không đóng", async ({
  page,
}) => {
  const st = await open(page, { items: [] });
  await page.getByRole("button", { name: "Thêm kết nối" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Thêm kết nối" });
  await dlg.getByRole("textbox", { name: "Tên" }).fill("kh-main");
  await dlg.getByRole("textbox", { name: "Địa chỉ" }).fill(ORIGIN);
  await pickKey(page, "kh-key-main");
  const cases: [unknown, string][] = [
    [
      err("KH_CONNECTION_EXISTS", { id: CID.main, field: "name" }),
      "Tên hoặc địa chỉ đã được kết nối khác dùng",
    ],
    [
      err("KH_SECRET_INVALID", { reason: "not_platform" }),
      "Khoá phải là secret KnowledgeHub của nền tảng",
    ],
    [err("KH_URL_NOT_ALLOWED", { reason: "not_in_allowlist" }), "Địa chỉ không được phép"],
  ];
  for (const [body, text] of cases) {
    st.once["POST /kh/connections"] = { status: body === cases[0]?.[0] ? 409 : 422, body };
    await dlg.getByRole("button", { name: "Lưu" }).click();
    await expect(dlg).toContainText(text);
  }
  await expect(dlg).toBeVisible();
});

test("HUB-FR-131 · Q34 · E06 · Sửa: đổi Địa chỉ ⇒ Alert 'Lưu sẽ đặt trạng thái về Chưa kiểm tra…'; chỉ đổi tên ⇒ không; PUT kèm version; 'Đã lưu · v2'", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Sửa kh-main" }).click();
  const dlg = page.getByRole("dialog", { name: "Sửa kết nối" });
  const warn =
    "Lưu sẽ đặt trạng thái về Chưa kiểm tra; agent ngừng dùng kết nối tới khi kiểm tra lại.";
  await dlg.getByRole("textbox", { name: "Tên" }).fill("kh-main-2");
  await expect(dlg.getByText(warn)).toHaveCount(0);
  await dlg.getByRole("textbox", { name: "Địa chỉ" }).fill(ORIGIN2);
  await expect(dlg.getByText(warn)).toBeVisible();
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().includes(`/kh/connections/${CID.main}`),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  expect((await put).postDataJSON()).toEqual({
    name: "kh-main-2",
    base_url: ORIGIN2,
    secret_id: SEC.main,
    summary_project: "proj-a",
    version: 1,
  });
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu · v2" })).toBeVisible();
});

test("HUB-FR-131 · K1-AC01 · E07 · Kiểm tra ⇒ POST check, Dialog 'Kết quả kiểm tra': 'Kết nối đạt', phiên bản, số project, cảnh báo embedder", async ({
  page,
}) => {
  const st = await open(page, {
    checkResult: check("ok", [
      {
        code: "kh_embedder_english",
        level: "warning",
        params: { model: "BAAI/bge-small-en-v1.5" },
      },
    ]),
  });
  await page.getByRole("button", { name: "Kiểm tra kh-alt" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối đạt");
  await expect(dlg).toContainText("Phiên bản KnowledgeHub: v6.4");
  await expect(dlg).toContainText("Project khoá thấy: 2");
  await expect(dlg.getByRole("list")).toContainText(
    "Embedder BAAI/bge-small-en-v1.5 chỉ hỗ trợ tiếng Anh",
  );
  expect(writes(st).map((x) => [x.method, x.path])).toEqual([
    ["POST", `/kh/connections/${CID.alt}/check`],
  ]);
});

test("HUB-BR-40 · Q27 · E08 · Kiểm tra lỗi ⇒ 'Kết nối chưa đạt: 2 lỗi' + câu mã kh_key_rejected / kh_version_too_old; badge dòng 'Lỗi'", async ({
  page,
}) => {
  await open(page, {
    checkResult: check(
      "error",
      [
        { code: "kh_key_rejected", level: "error" },
        { code: "kh_version_too_old", level: "error", params: { found: "v6.3" } },
      ],
      [],
    ),
  });
  await page.getByRole("button", { name: "Kiểm tra kh-main" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối chưa đạt: 2 lỗi");
  await expect(dlg).toContainText("KnowledgeHub từ chối khoá (hoặc đang ở chế độ đăng nhập SSO)");
  await expect(dlg).toContainText("Phiên bản KnowledgeHub phải ≥ v6.4 (hiện v6.3)");
  await page.keyboard.press("Escape");
  await expect(table(page).getByRole("row").filter({ hasText: "kh-main" })).toContainText("Lỗi");
});

test("HUB-FR-131 · E09 · Xoá: alertdialog 'Secret không bị xoá.'; KH_CONNECTION_IN_USE ⇒ alert 'agent đang dùng', không đóng; xoá được ⇒ DELETE ?version + toast", async ({
  page,
}) => {
  const st = await open(page);
  st.once[`DELETE /kh/connections/${CID.main}`] = {
    status: 409,
    body: err("KH_CONNECTION_IN_USE", { agents: 1 }),
  };
  await page.getByRole("button", { name: "Xoá kh-main" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Secret không bị xoá.");
  await dlg.getByRole("button", { name: "Xoá" }).click();
  await expect(dlg.getByRole("alert")).toContainText("agent đang dùng");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await page.getByRole("button", { name: "Xoá kh-alt" }).click();
  const del = page.waitForRequest((r) => r.method() === "DELETE");
  await page.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
  expect((await del).url()).toContain(`/kh/connections/${CID.alt}?version=1`);
  await expect(toast(page)).toContainText("Đã xoá kết nối kh-alt");
  await expect(table(page)).not.toContainText("kh-alt");
});

test("HUB-FR-132 · E10 · Sửa agent CLI → region 'KnowledgeHub': tick kh-alt rồi kh-main ⇒ [Lưu] PUT /agents/:id/knowledge {connection_ids theo thứ tự tick, version}; toast", async ({
  page,
}) => {
  const store = seedStore();
  for (const a of store.agents) a.knowledge_connection_ids = [];
  await mockStudio(page, { session: true, store });
  await mockKh(page);
  const puts: Record<string, unknown>[] = [];
  await page.route(/\/studio\/api\/agents\/[^/]+\/knowledge$/, async (route) => {
    const b = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(b);
    const a = store.agents.find((x) => x.id === ID.hoadon);
    return route.fulfill({
      status: 200,
      json: {
        agent: { ...a, knowledge_connection_ids: b.connection_ids, version: 2 },
        hub_config_version: 8,
      },
    });
  });
  await openAuthed(page, `/agents/${ID.hoadon}`);
  const sec = page.getByRole("region", { name: "KnowledgeHub" });
  await sec.getByRole("checkbox", { name: "kh-alt" }).check();
  await sec.getByRole("checkbox", { name: "kh-main" }).check();
  await sec.getByRole("button", { name: "Lưu" }).click();
  await expect.poll(() => puts).toEqual([{ connection_ids: [CID.alt, CID.main], version: 1 }]);
  await expect(toast(page)).toContainText("Đã lưu kết nối của agent");
});

test("HUB-FR-132 · Q22 · E11 · tick đủ 5 ⇒ ô thứ 6 disabled + 'Tối đa 5 kết nối'; agent llm ⇒ section disabled + 'Chỉ agent chạy bằng CLI mới dùng được tri thức'", async ({
  page,
}) => {
  const store = seedStore();
  for (const a of store.agents) a.knowledge_connection_ids = [];
  await mockStudio(page, { session: true, store });
  const six = Array.from({ length: 6 }, (_, i) =>
    conn({ id: k(200 + i), name: `kh-${i}`, base_url: `${ORIGIN}/${i}` }),
  );
  await mockKh(page, { items: six });
  await openAuthed(page, `/agents/${ID.hoadon}`);
  const sec = page.getByRole("region", { name: "KnowledgeHub" });
  for (let i = 0; i < 5; i++) await sec.getByRole("checkbox", { name: `kh-${i}` }).check();
  await expect(sec.getByRole("checkbox", { name: "kh-5" })).toBeDisabled();
  await expect(sec).toContainText("Tối đa 5 kết nối");
  await openAuthed(page, `/agents/${ID.helper}`);
  const llm = page.getByRole("region", { name: "KnowledgeHub" });
  await expect(llm).toContainText("Chỉ agent chạy bằng CLI mới dùng được tri thức");
  await expect(llm.getByRole("checkbox", { name: "kh-0" })).toBeDisabled();
});

test("HUB-FR-132 · E12 · agent đã gắn ⇒ checkbox kh-main đã tick sẵn; kết nối chưa đạt kèm 'Chưa dùng được tới khi kiểm tra đạt'", async ({
  page,
}) => {
  const store = seedStore();
  for (const a of store.agents) a.knowledge_connection_ids = a.id === ID.hoadon ? [CID.main] : [];
  await mockStudio(page, { session: true, store });
  await mockKh(page, { items: [MAIN(), ALT()] });
  await openAuthed(page, `/agents/${ID.hoadon}`);
  const sec = page.getByRole("region", { name: "KnowledgeHub" });
  await expect(sec.getByRole("checkbox", { name: "kh-main" })).toBeChecked();
  await expect(sec.getByRole("checkbox", { name: "kh-alt" })).not.toBeChecked();
  await expect(sec).toContainText("Chưa dùng được tới khi kiểm tra đạt");
});

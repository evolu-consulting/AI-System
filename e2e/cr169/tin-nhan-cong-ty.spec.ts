// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-169 · hành trình «nhắn tin người–người giữa hai công ty đã kết nối» (G4, N2: mỗi bước đúng vai, người nhắn KHÁC người mời kết nối).
// Stack + hai công ty: `e2e/cr161/_cr161-stack.ts`, người/công ty: `e2e/_kit/two-companies*.ts`. Nhãn nguyên văn theo spec CR-169 §8 + i18n `contracts.messages.*`.
// NitiGroup-test: Tiên (Toàn quyền, người mời), Vy + Lan (nhân viên), Nam (bị gỡ quyền Sổ Hợp Tác). Preschool-test: Dung (Toàn quyền, người đồng ý), Hà (nhân viên).
// Chạy NỐI TIẾP (mỗi ca dựa trên ca trước): kết nối (beforeAll, qua API) → Vy nhắn Hà kèm PDF → Hà đọc/trả lời → lọc/tìm → thu hồi → Bảng tin công ty
// → ngoài cuộc/không quyền → (Chat AI app) → ngắt kết nối ⇒ chỉ đọc. Không sleep: chờ theo điều kiện (stream đẩy tin/«Đã xem»).
import { type Browser, expect, type Page, test } from "@playwright/test";
import { apiLogin, type Session, tenantIdByKey } from "../_kit/api";
import { CO, NAME, WHO } from "../_kit/two-companies";
import { type Env, loginCw } from "../journey-approval/_journey";

test.describe.configure({ mode: "serial" });

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.cr169.config.ts)`);
  return v;
};
const envOf = (side: "a" | "b"): Env => ({
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: CO[side].key(),
  tenantName: CO[side].name,
});
const [EA, EB] = [envOf("a"), envOf("b")];
const HUB = need("JA_HUB_URL");
const RUN = need("CR169_RUN");
const VY = "E2E Nhân viên Kinh doanh"; // tên hiển thị của Vy (`JOURNEY_SPEC`)
const HELLO = `Chào Hà, gửi báo giá ${RUN}`;
const REPLY = `Preschool nhận được, cảm ơn ${RUN}`;
const OOPS = `Nhầm số liệu, sẽ gửi lại ${RUN}`;
const FILE = `bao-gia-${RUN}.pdf`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const open = async (browser: Browser, e: Env, user: string) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, e, user);
  return { ctx, page };
};
/** CR-190 · công ty đối tác = nhóm «dir-group» ở cột trái (thay tab «Đối tác ▾»): mở nhóm nếu đang thu. */
const pickPartner = async (page: Page, name: string) => {
  const head = page
    .getByTestId("dir-group-head")
    .filter({ hasText: new RegExp(name) })
    .first();
  await expect(head).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
};
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Tìm người, nhóm, công ty" });
const msgBadge = (page: Page) =>
  page.getByTestId("nav-contracts-messages").getByTestId("nav-badge");
const rowOf = (page: Page, text: string) => page.getByTestId("conv-row").filter({ hasText: text });
const msgOf = (page: Page, text: string) => page.getByTestId("msg-row").filter({ hasText: text });
const apiOf = (e: Env, user: string): Promise<Session> =>
  apiLogin({
    base: need("JA_API_URL"),
    tenantKey: e.tenantKey,
    username: user,
    password: e.pw,
    app: "contracts",
  });
let tenantA = "";
let tenantB = "";
let convId = "";

test.beforeAll(async () => {
  const p = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  tenantA = await tenantIdByKey(need("JA_API_URL"), p, EA.tenantKey);
  tenantB = await tenantIdByKey(need("JA_API_URL"), p, EB.tenantKey);
  // Danh mục app của stack test để URL rỗng ⇒ `/auth/me/apps` không liệt kê Sổ Hợp Tác ⇒ chat-web ẩn mục «Tin nhắn». Đặt URL (DB riêng của job này).
  const patch = await fetch(`${need("JA_API_URL")}/admin/apps/contracts`, {
    method: "PATCH",
    headers: { ...p.headers, "content-type": "application/json" },
    body: JSON.stringify({ url: need("JA_CW_URL"), enabled: true }),
  });
  expect(patch.status).toBe(200);
  // Kết nối dựng qua API (đã có e2e UI ở CR-161): Tiên (Toàn quyền) mời, Dung (Toàn quyền) đồng ý.
  const [tien, dung] = [await apiOf(EA, WHO.tien), await apiOf(EB, WHO.dung)];
  const inv = await fetch(`${HUB}/pack/contracts/connect/invites`, {
    method: "POST",
    headers: { ...tien.headers, "content-type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantB }),
  });
  expect(inv.status).toBe(200);
  const acc = await fetch(`${HUB}/pack/contracts/connect/links/${tenantA}/accept`, {
    method: "POST",
    headers: dung.headers,
  });
  expect(acc.status).toBe(200);
});

test("CR169-J1 · Vy (nhân viên, không phải người mời) › Tin nhắn › chip Preschool › tìm Hà ⇒ thấy tên + chức vụ + công ty, không email; nhắn chữ + PDF", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.vy);
  await page.goto("/contracts/messages");
  await pickPartner(page, CO.b.name);
  await searchBox(page).fill("Hà Mai");
  await page.getByTestId("find-tab-people").click(); // CR-178 M3: tìm ≥ 2 ký tự mở tab «Tin nhắn» trước; người nằm ở tab «Người»
  const row = rowOf(page, NAME.ha).first();
  await expect(row).toContainText(NAME.ha);
  await expect(row).toContainText(CO.b.name);
  await expect(row).not.toContainText("@"); // không lộ email / điện thoại
  await row.click();
  await expect(page.getByTestId("chat-title")).toContainText(NAME.ha);
  await expect(page.getByTestId("chat-company")).toContainText(CO.b.name);
  await page.getByTestId("composer-file-input").setInputFiles({
    name: FILE,
    mimeType: "application/pdf",
    buffer: PDF,
  });
  // tệp tải lên ngay khi chọn: chờ thẻ «Tệp sẽ gửi» có tên tệp và hết «Đang tải…» rồi mới bấm Gửi
  const drafts = page.getByTestId("draft-list");
  await expect(drafts).toContainText(FILE);
  await expect(drafts).not.toContainText("Đang tải");
  await page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  const sent = msgOf(page, HELLO);
  await expect(sent).toBeVisible();
  await expect(sent.getByTestId("msg-files")).toContainText(FILE);
  await ctx.close();
});

test("CR169-J2 · Hà thấy số chưa đọc ở «Tin nhắn», mở ⇒ tin + tải đúng tên PDF, trả lời ⇒ Vy thấy «Đã xem» và câu trả lời tức thì", async ({
  browser,
}) => {
  // Vy mở sẵn cuộc (nhận «Đã xem» + trả lời qua /me/stream, không tải lại)
  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages?company=all");
  await rowOf(v.page, NAME.ha).click();
  await expect(msgOf(v.page, HELLO)).toBeVisible();

  const h = await open(browser, EB, WHO.ha);
  await h.page.goto("/contracts/messages?company=all");
  await expect(msgBadge(h.page)).toHaveText("1");
  const row = rowOf(h.page, VY);
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(row.getByTestId("conv-company-line")).toContainText(CO.a.name);
  await h.page.getByTestId("tab-unread").click(); // CR-178: Hà (người nhận, không phải người tạo cuộc) thấy cuộc ở «Chưa đọc»
  await expect(row).toBeVisible();
  await row.click();
  await expect(h.page.getByTestId("chat-company")).toContainText(CO.a.name);
  await expect(h.page.getByTestId("open-feed")).toHaveCount(0); // CR-179: bỏ nút «Bảng tin» ở Tin nhắn
  const got = msgOf(h.page, HELLO);
  await expect(got).toBeVisible();
  await expect(msgBadge(h.page)).toHaveCount(0);
  const down = h.page.waitForEvent("download");
  await got.getByTestId("file-download").first().click();
  expect((await down).suggestedFilename()).toBe(FILE);

  await expect(v.page.getByTestId("msg-seen")).toHaveAttribute("aria-label", /Đã xem/);
  await expect(v.page.getByTestId("msg-time").last()).toBeVisible(); // giờ dưới tin cuối nhóm, không cần rê chuột
  await h.page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(REPLY);
  await h.page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(msgOf(h.page, REPLY)).toBeVisible();
  await expect(msgOf(v.page, REPLY)).toBeVisible();
  await v.ctx.close();
  await h.ctx.close();
});

test("CR169-J3 · Vy: lọc chip công ty (Preschool / công ty mình) và tìm theo tên ngay trong danh sách cuộc", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.vy);
  await page.goto("/contracts/messages");
  // CR-178: mặc định «Tất cả» = cuộc gần đây (gồm cả cuộc với Hà), nhãn công ty cam cạnh tên
  await expect(page.getByTestId("tab-all")).toHaveAttribute("aria-pressed", "true");
  await expect(rowOf(page, NAME.ha)).toBeVisible();
  await pickPartner(page, CO.b.name);
  await expect(rowOf(page, NAME.ha)).toHaveCount(1);
  await expect(rowOf(page, NAME.ha).getByTestId("conv-company")).toContainText(CO.b.name);
  await searchBox(page).fill("Mai"); // tên không dấu vẫn khớp «Hà Mai»
  await page.getByTestId("find-tab-people").click(); // CR-178 M3: cuộc + người ở tab «Người»
  await expect(rowOf(page, NAME.ha)).toBeVisible();
  await searchBox(page).fill("");
  await page.getByTestId("tab-all").click();
  await page.getByTestId("tab-unread").click(); // đã đọc hết ⇒ «Chưa đọc» không còn cuộc với Hà
  await expect(rowOf(page, NAME.ha)).toHaveCount(0);
  await ctx.close();
});

test("CR172-J1 · Tin nhắn: nút Gửi và Đính kèm cùng một hàng cố định ở đáy ô soạn (dưới ô chữ), Sổ Hợp Tác và Chat AI cùng gói", async ({
  browser,
}) => {
  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages?company=all");
  await rowOf(v.page, NAME.ha).click();
  const box = v.page.getByRole("textbox", { name: "Nhập tin nhắn" });
  const mid = async (l: import("@playwright/test").Locator) => {
    const b = await l.boundingBox();
    if (!b) throw new Error("không có khung");
    return b.y + b.height / 2;
  };
  // CR-178: chữ ở trên, hàng nút ở đáy: hai nút cùng hàng và nằm dưới ô chữ; gõ thêm dòng thì hàng nút không nhảy ngang
  const send = await mid(v.page.getByRole("button", { name: "Gửi", exact: true }));
  const attach = await mid(v.page.getByRole("button", { name: "Đính kèm tệp" }));
  expect(Math.abs(send - attach)).toBeLessThanOrEqual(1);
  expect(send).toBeGreaterThan(await mid(box));
  await v.ctx.close();
});

test("CR169-J4 · Vy gửi nhầm một tin rồi thu hồi ⇒ cả hai bên chỉ còn «Tin nhắn đã được thu hồi»", async ({
  browser,
}) => {
  const v = await open(browser, EA, WHO.vy);
  const h = await open(browser, EB, WHO.ha);
  await v.page.goto("/contracts/messages?company=all");
  await h.page.goto("/contracts/messages?company=all");
  await rowOf(v.page, NAME.ha).click();
  await rowOf(h.page, VY).click();
  await v.page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(OOPS);
  await v.page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(msgOf(v.page, OOPS)).toBeVisible();
  await expect(msgOf(h.page, OOPS)).toBeVisible();

  // CR-178 · «⋯»: Hà (người nhận) chỉ có «Sao chép»; Vy (người gửi) có thêm «Thu hồi»
  await h.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const theirs = msgOf(h.page, OOPS);
  await theirs.hover();
  await theirs.getByTestId("msg-more").click();
  await expect(h.page.getByTestId("msg-menu").getByTestId("msg-revoke")).toHaveCount(0);
  await h.page.getByTestId("msg-copy").click();
  await expect(h.page.getByText("Đã sao chép")).toBeVisible();
  const mine = msgOf(v.page, OOPS);
  await mine.hover();
  await mine.getByTestId("msg-more").click();
  await v.page.getByTestId("msg-menu").getByTestId("msg-revoke").click();
  await v.page
    .getByRole("dialog", { name: "Thu hồi" })
    .getByRole("button", { name: "Đồng ý", exact: true })
    .click();
  await expect(v.page.getByText(OOPS)).toHaveCount(0);
  await expect(h.page.getByText(OOPS)).toHaveCount(0); // đã thu hồi ở phía Preschool, tức thì
  await expect(h.page.getByTestId("msg-list")).toContainText("Tin nhắn đã được thu hồi");
  await v.ctx.close();
  await h.ctx.close();
});

test("CR169-J6 · N2 cách ly: Lan (cùng công ty, ngoài cuộc) không thấy cuộc Vy–Hà; Nam (không còn quyền Sổ Hợp Tác) bị chặn", async ({
  browser,
}) => {
  const vy = await apiOf(EA, WHO.vy);
  const list = await fetch(`${HUB}/pack/contracts/messages/conversations?limit=30`, {
    headers: vy.headers,
  });
  expect(list.status).toBe(200);
  const items = ((await list.json()) as { items: { id: string; kind: string }[] }).items;
  convId = items.find((c) => c.kind === "partner")?.id ?? "";
  expect(convId).not.toBe("");

  const lan = await apiOf(EA, WHO.lan);
  const peek = await fetch(`${HUB}/pack/contracts/messages/partner/${convId}`, {
    headers: lan.headers,
  });
  expect(peek.status).toBe(404); // người ngoài cuộc: «không tìm thấy»
  const { ctx, page } = await open(browser, EA, WHO.lan);
  await page.goto("/contracts/messages");
  await expect(page.getByTestId("dir-list").or(page.getByTestId("conv-empty"))).toBeVisible();
  await expect(rowOf(page, NAME.ha)).toHaveCount(0);
  await ctx.close();

  // Nam: mất nhóm gói ⇒ hoặc không đăng nhập được app Sổ Hợp Tác, hoặc mọi route tin nhắn trả 403
  const nam = await apiOf(EA, WHO.nam).catch(() => null);
  test.info().annotations.push({
    type: "nam",
    description: nam
      ? "đăng nhập được ⇒ mọi route tin nhắn 403"
      : "đăng nhập app Sổ Hợp Tác bị từ chối",
  });
  if (nam) {
    const r = await fetch(`${HUB}/pack/contracts/messages/partner/${convId}`, {
      headers: nam.headers,
    });
    expect(r.status).toBe(403);
    const l = await fetch(`${HUB}/pack/contracts/messages/conversations?limit=30`, {
      headers: nam.headers,
    });
    expect(l.status).toBe(403);
  }
});

// Chat AI app (lát 8 `cr169-chat-web`): chat-web cùng stack (`playwright.cr169.config.ts` dựng, `JA_CHAT_URL`). Mục «Tin nhắn» ở thanh bên chat-web
// dùng cùng gói `messages-web`; ô hỏi trợ lý của chat-web là textbox «Tin nhắn» (khác ô soạn «Nhập tin nhắn» của cuộc người–người).
test("CR169-J7 · Chat AI app: Hà vào mục «Tin nhắn» thấy cùng cuộc với Vy, gửi một tin ⇒ Vy (Sổ Hợp Tác) nhận tức thì; trợ lý AI không trích tin nhắn", async ({
  browser,
}) => {
  const NEW = `Tin từ Chat AI ${RUN}`;
  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages?company=all");
  await rowOf(v.page, NAME.ha).click();

  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${need("JA_CHAT_URL")}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(EB.tenantKey);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(WHO.ha);
  await page.getByLabel("Mật khẩu").fill(EB.pw);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  // đăng nhập hạ cánh ở trang chủ cổng ứng dụng: vào Chat AI rồi chờ phiên xong (ô hỏi trợ lý hiện) mới tới thanh bên
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`${need("JA_CHAT_URL")}/c/new`);
  await expect(page.getByRole("textbox", { name: "Tin nhắn", exact: true })).toBeVisible();
  await page.getByTestId("nav-messages").click();
  await expect(page.getByTestId("user-chip")).toBeVisible(); // CR-172: Chat AI cũng hiện avatar + tên ở thanh trên
  await rowOf(page, VY).click();
  await expect(msgOf(page, HELLO)).toBeVisible(); // cùng dữ liệu với Sổ Hợp Tác
  await page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(NEW);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(msgOf(page, NEW)).toBeVisible();
  await expect(msgOf(v.page, NEW)).toBeVisible(); // Vy nhận tức thì

  // trợ lý AI: hỏi về tin nhắn ⇒ khung trợ lý không có nội dung các tin (trợ lý không đọc tin nhắn)
  await page.goto(`${need("JA_CHAT_URL")}/c/new`);
  await page
    .getByRole("textbox", { name: "Tin nhắn", exact: true })
    .fill("tóm tắt tin nhắn của Vy");
  await page.keyboard.press("Enter");
  const log = page.getByRole("log", { name: "Nội dung hội thoại" });
  await expect(log).toContainText("tóm tắt tin nhắn của Vy");
  await expect(log).not.toContainText(HELLO);
  await expect(log).not.toContainText(REPLY);
  await v.ctx.close();
  await ctx.close();
});

test("CR169-J8 · Tiên (người mời) › Đối tác › Preschool: 3 tab, không «Thao tác»; ngắt kết nối ⇒ Vy mở cuộc thấy tin cũ + câu chỉ đọc, không ô soạn, mất chip Preschool", async ({
  browser,
}) => {
  const a = await open(browser, EA, WHO.tien);
  await a.page.goto("/contracts/partners");
  await a.page
    .getByTestId("connected-list")
    .getByRole("link", { name: "Mở trang đối tác" })
    .click();
  await expect(a.page.getByRole("tab")).toHaveText([
    /^Tổng quan$/,
    /^Hợp đồng/,
    /^Sổ việc & ghi chú$/,
  ]);
  await expect(a.page.getByRole("button", { name: "Thao tác", exact: true })).toHaveCount(0);
  await a.page.goto("/contracts/partners");
  await a.page.getByRole("button", { name: `Ngắt kết nối với ${CO.b.name}` }).click();
  await a.page
    .getByRole("dialog", { name: `Ngắt kết nối với ${CO.b.name}?` })
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await expect(a.page.getByTestId("connected-list")).toHaveCount(0);
  await a.ctx.close();

  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages?company=all");
  await expect(v.page.getByTestId("dir-list")).toBeVisible(); // hết kết nối ⇒ hết nhóm công ty ở cột trái
  await expect(
    v.page.getByTestId("dir-group-head").filter({ hasText: new RegExp(CO.b.name) }),
  ).toHaveCount(0);
  await rowOf(v.page, NAME.ha).click(); // cuộc cũ vẫn nằm ở «Tất cả»
  await expect(msgOf(v.page, HELLO)).toBeVisible();
  await expect(msgOf(v.page, REPLY)).toBeVisible();
  await expect(v.page.getByTestId("read-only-notice")).toContainText("không còn kết nối");
  await expect(v.page.getByRole("textbox", { name: "Nhập tin nhắn" })).toHaveCount(0);
  await v.ctx.close();

  const h = await open(browser, EB, WHO.ha); // phía kia cũng chỉ đọc
  await h.page.goto("/contracts/messages?company=all");
  await rowOf(h.page, VY).click();
  await expect(h.page.getByTestId("read-only-notice")).toBeVisible();
  await expect(h.page.getByRole("textbox", { name: "Nhập tin nhắn" })).toHaveCount(0);
  await h.ctx.close();
});

test("CR172-J2 · thanh trên hiện avatar + tên người đăng nhập ở Sổ Hợp Tác", async ({
  browser,
}) => {
  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages");
  await expect(v.page.getByTestId("user-chip")).toBeVisible();
  await expect(v.page.getByTestId("user-chip-name")).toHaveText(VY);
  await expect(v.page.getByTestId("user-chip").getByRole("img", { name: VY })).toBeVisible();
  await v.ctx.close();
});

test("CR172-J3 · trạng thái «chưa chọn cuộc» căn giữa ngang + dọc, phủ 100% vùng nội dung", async ({
  browser,
}) => {
  const v = await open(browser, EA, WHO.vy);
  await v.page.goto("/contracts/messages");
  const pick = v.page.getByTestId("chat-pick");
  const outer = v.page.getByTestId("messages-page");
  const [a, b] = [await pick.boundingBox(), await outer.boundingBox()];
  if (!a || !b) throw new Error("không có khung");
  const pane = a.width; // vùng phải = cột còn lại của khung
  expect(a.height).toBeGreaterThan(b.height - 4); // cao 100% vùng nội dung
  expect(a.x + pane).toBeGreaterThan(b.x + b.width - 4); // rộng tới mép phải
  const art = await pick.locator("svg").first().boundingBox();
  if (!art) throw new Error("không có hình");
  expect(Math.abs(art.x + art.width / 2 - (a.x + a.width / 2))).toBeLessThanOrEqual(2);
  expect(art.y + art.height / 2).toBeLessThan(a.y + a.height * 0.6); // hình + chữ là khối giữa dọc
  expect(art.y).toBeGreaterThan(a.y + a.height * 0.1); // không dồn lên đầu
  await v.ctx.close();
});

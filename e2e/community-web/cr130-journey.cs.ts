// CR-130 · HÀNH TRÌNH THẬT (D5, không mock) trên stack community-web (playwright.stack.config.ts, chỉ nhận `*.cs.ts`). VIẾT, CHƯA CHẠY.
// Dữ liệu tạo qua đường người dùng/platform: tài khoản công ty đối tác + user (admin-api), quy trình duyệt đơn tham gia (platform),
// đối tác SHT (chỉ hàng vai `partner_roles` qua owner SQL — SHT chưa có API tạo đối tác không cần MST), còn lại đi bằng giao diện.
//  J1 · Mời đối tác: SHT › Đối tác › chi tiết › tab «Bảng tin» ⇒ sửa nhóm hàng ⇒ «Mời vào Bảng tin» ⇒ đối tác đăng nhập: thấy bài
//       «Khách hàng» của chủ quản, có chuông chung, KHÔNG có nút trợ lý.
//  J2 · Duyệt yêu cầu tham gia «Gắn với đối tác có sẵn» ⇒ hồ sơ SHT hiện tài khoản đã gắn; đối tác đã gắn tài khoản khác ⇒ câu hướng dẫn, đơn còn chờ.
//  J3 · Một trợ lý (khoang phải chung) + một Cài đặt (nhóm «Bảng tin» › Thông báo; /community?settings=1).
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, createPost, pageFetch, tenantIdByKey } from "../_kit/api";
import { approve, createCompanyFlow, enableFlowTriggers, finish } from "../_kit/flows";
import { withOwner } from "../support/helpers";
import { NEW_PW, openAs, TENANT, USERNAME } from "./_stack";

/* biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo) */
const API = process.env.CS_API_URL ?? "";
const HUB = process.env.CS_HUB_URL ?? "";
const RUN = Date.now().toString(36);
const P1 = `Công ty Mời Thử ${RUN}`; // đối tác SHT chưa mời (J1)
const P2 = `Công ty Gắn Thử ${RUN}`; // đối tác SHT chưa có tài khoản (J2 đích gắn)
const ORG1 = `Tài khoản Mời ${RUN}`;
const ORG_A = `Tài khoản Xin A ${RUN}`;
const ORG_B = `Tài khoản Xin B ${RUN}`;
const FLOW = `Quản trị tham gia ${RUN}`;
const POST = `Bài cho khách hàng ${RUN}`;
const CATS = `Chữ ký số ${RUN}, Đóng gói`;

type Cred = { username: string; pw: string; org: string };
const state: { tid?: string; pk1?: string; pk2?: string; u1?: Cred; ua?: Cred; ub?: Cred } = {};

async function platform() {
  return apiLogin({
    base: API,
    tenantKey: "platform",
    username: process.env.SEED_ADMIN_USERNAME ?? "",
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  });
}

/** Tài khoản công ty ngoài + một user đăng nhập được (đường platform/tenant admin của admin-api). Trả mật khẩu tạm. */
async function makeOrgUser(name: string, username: string): Promise<Cred> {
  const s = await platform();
  const tid = state.tid ?? (await tenantIdByKey(API, s, TENANT));
  state.tid = tid;
  const h = { "content-type": "application/json", authorization: `Bearer ${s.token}` };
  const o = await fetch(`${API}/admin/external-orgs?tenant_id=${tid}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name }),
  });
  expect(o.status, "tạo tài khoản công ty").toBe(201);
  const org = (await o.json()) as { id: string };
  const u = await fetch(`${API}/admin/external-orgs/${org.id}/users`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      username,
      display_name: `Người của ${name}`,
      email: `${username}@example.test`,
    }),
  });
  expect(u.status, "tạo user đối tác").toBe(201);
  const body = (await u.json()) as { temp_password: string };
  return { username, pw: body.temp_password, org: name };
}

/** Đối tác SHT chưa có tài khoản Bảng tin: một hàng vai «Khách hàng» (khoá `name:<fold>`), trả party_key. */
async function makePartner(name: string): Promise<string> {
  const tid = state.tid as string;
  return withOwner(async (sql) => {
    const [r] = await sql<{ pk: string }[]>`
      insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from)
      values (${tid}::uuid, 'name:' || contracts.fold(${name}), 'customer', ${name}, 'manual')
      returning party_key as pk`;
    return (r as { pk: string }).pk;
  });
}

/** Đăng nhập đối tác mới (mật khẩu tạm ⇒ form đặt mật khẩu mới) tại màn Đăng nhập của community-web. */
async function loginCred(page: Page, c: Cred): Promise<void> {
  await page.goto("/login?next=%2Fcommunity");
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)/ }).fill(c.username);
  await pw.fill(c.pw);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  const change = page.getByRole("heading", { name: "Đặt mật khẩu mới" });
  const feed = page.getByTestId("composer").or(page.getByTestId("post").first());
  await expect(change.or(feed)).toBeVisible({ timeout: 45_000 });
  if (await change.isVisible()) {
    const fields = page.locator("input[type=password]");
    for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(NEW_PW);
    await page.locator("button[type=submit]").first().click();
  }
  await expect(page.getByTestId("topbar-bell")).toBeVisible({ timeout: 45_000 });
}

const sht = (key: string) => `/contracts/partners?party=${encodeURIComponent(key)}&tab=community`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const s = await platform();
  state.tid = await tenantIdByKey(API, s, TENANT);
  state.pk1 = await makePartner(P1);
  state.pk2 = await makePartner(P2);
  state.u1 = await makeOrgUser(ORG1, `cr130-m-${RUN}`);
  state.ua = await makeOrgUser(ORG_A, `cr130-a-${RUN}`);
  state.ub = await makeOrgUser(ORG_B, `cr130-b-${RUN}`);
});

test("CR130-J1 · quản trị gói mời đối tác chưa mời vào Bảng tin ⇒ đối tác thấy Bảng tin + chuông chung, không có trợ lý, thấy bài «Khách hàng»", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await openAs(browser, "host");
  await host.page.goto(sht(state.pk1 as string));
  await host.page.getByRole("tab", { name: "Bảng tin" }).click();
  const box = host.page.getByTestId("partner-community");
  await expect(box).toBeVisible();
  await expect(host.page.getByRole("button", { name: "Mời vào Bảng tin" })).toBeVisible(); // chưa mời
  // sửa nhóm hàng ⇒ lưu hồ sơ
  await box.getByLabel("Nhóm hàng").fill(CATS);
  await box.getByRole("button", { name: "Lưu hồ sơ" }).click();
  await expect(host.page.getByText("Đã lưu hồ sơ Bảng tin")).toBeVisible();
  await host.page.reload();
  await host.page.getByRole("tab", { name: "Bảng tin" }).click();
  await expect(host.page.getByLabel("Nhóm hàng")).toHaveValue(CATS);
  // mời: chọn tài khoản công ty ngoài chưa gắn
  await host.page.getByLabel("Chọn tài khoản công ty").selectOption({ label: ORG1 });
  await host.page.getByRole("button", { name: "Mời vào Bảng tin" }).click();
  await expect(host.page.getByText("Đã mời đối tác vào Bảng tin")).toBeVisible();
  await expect(host.page.getByTestId("pcm-account")).toContainText(ORG1);
  await expect(host.page.getByRole("button", { name: "Gỡ khỏi Bảng tin" })).toBeVisible();

  // chủ quản đăng bài cho «Khách hàng» (đường API như người dùng bấm Đăng; kiểm luồng thấy bài, không kiểm ô soạn)
  const api = await apiLogin({
    fx: pageFetch(host.page),
    base: "",
    tenantKey: TENANT,
    username: USERNAME.host,
    password: process.env.DEMO_OWNER_PW ?? "",
    app: "contracts",
  });
  await createPost("", api, { type: "note", body: POST, audience: { mode: "buyers" } });

  const ctx = await browser.newContext({ baseURL: process.env.COMMUNITY_URL });
  const page = await ctx.newPage();
  await loginCred(page, state.u1 as Cred);
  await page.goto("/community");
  await expect(page.getByTestId("topbar-bell")).toBeVisible(); // một chuông chung, kể cả đối tác trong Bảng tin
  await expect(page.getByRole("button", { name: "Mở trợ lý AI" })).toHaveCount(0); // đối tác không có trợ lý
  await expect(page.getByRole("complementary", { name: "Trợ lý AI" })).toHaveCount(0);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("post").filter({ hasText: POST })).toBeVisible({
      timeout: 4_000,
    });
  }).toPass({ timeout: 60_000 });
  await ctx.close();
  await host.ctx.close();
});

test("CR130-J2 · duyệt đơn tham gia «Gắn với đối tác có sẵn» ⇒ hồ sơ SHT hiện tài khoản; đối tác đã gắn tài khoản khác ⇒ hướng dẫn, đơn vẫn chờ", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  // quy trình duyệt đơn tham gia của công ty (đường platform; không bật sẵn trong seed)
  const s = await platform();
  await createCompanyFlow(HUB, s.token, state.tid as string, {
    name: FLOW,
    app: "community",
    event: "partner.join_requested",
    inputs: [{ key: "join_id", label: "Đơn tham gia", type: "text", required: true }],
    stages: [
      approve("duyet-don", "Duyệt đơn", 0, "contracts-owner", { reject: 2, ret: 2 }),
      finish("nhan", "Nhận", 1, "accepted"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
    ],
  });
  await enableFlowTriggers(TENANT);

  for (const c of [state.ua, state.ub] as Cred[]) {
    const ctx = await browser.newContext({ baseURL: process.env.COMMUNITY_URL });
    const page = await ctx.newPage();
    await loginCred(page, c);
    await page.goto("/community/join");
    await page.getByTestId("join-company").fill(c.org);
    await page.getByTestId("join-contact").fill("Người liên hệ");
    await page.getByTestId("join-email").fill(`${c.username}@example.test`);
    await page.getByTestId("join-reason").fill("Muốn tham gia Bảng tin");
    await page.getByTestId("join-submit").click();
    await expect(page.getByTestId("join-sent")).toBeVisible();
    await ctx.close();
  }

  const host = await openAs(browser, "host");
  const openItem = async (org: string) => {
    const item = host.page.getByTestId("join-item").filter({ hasText: org });
    await expect(async () => {
      await host.page.goto("/community/join");
      await expect(item.getByTestId("join-approve")).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 240_000 }); // bước duyệt mở sau bước kiểm tra của hệ thống
    return item;
  };
  const link = async (item: ReturnType<Page["getByTestId"]>) => {
    await item.getByTestId("join-mode-link").click();
    await item.getByLabel("Chọn đối tác").selectOption({ label: P2 });
    await expect(item.getByTestId("join-approve-summary")).toContainText(P2);
    await item.getByTestId("join-approve").click();
  };

  // ca 1: gắn thành công ⇒ hồ sơ SHT của đối tác hiện tài khoản đã gắn
  const a = await openItem(ORG_A);
  await link(a);
  await expect(a.getByTestId("join-approve")).toHaveCount(0);
  await host.page.goto(sht(state.pk2 as string));
  await host.page.getByRole("tab", { name: "Bảng tin" }).click();
  await expect(host.page.getByTestId("pcm-account")).toContainText(ORG_A);

  // ca 2: đối tác đã gắn tài khoản khác ⇒ câu hướng dẫn nói cách sửa; đơn vẫn chờ (còn nút Duyệt)
  const b = await openItem(ORG_B);
  await link(b);
  await expect(
    host.page.getByText("Đối tác này đã có tài khoản Bảng tin. Chọn đối tác khác"),
  ).toBeVisible();
  await expect(b.getByTestId("join-approve")).toBeVisible();
  await host.ctx.close();
});

test("CR130-J3 · một trợ lý (khoang phải chung) + một Cài đặt (nhóm «Bảng tin» › Thông báo; /community?settings=1)", async ({
  browser,
}) => {
  const host = await openAs(browser, "host");
  const p = host.page;
  await p.goto("/community");
  await expect(p.getByRole("button", { name: /trợ lý/i })).toHaveCount(1); // chỉ MỘT nút trợ lý (không nút riêng của Bảng tin)
  await p.getByRole("button", { name: "Mở trợ lý AI" }).click();
  await expect(p.getByRole("complementary", { name: "Trợ lý AI" })).toBeVisible();
  await expect(p.getByRole("complementary", { name: "Trợ lý AI" })).toHaveCount(1);

  await p.getByRole("button", { name: "Tài khoản" }).click();
  await p.getByRole("menuitem", { name: /^Cài đặt/ }).click();
  await expect(p.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await expect(p.getByTestId("settings-group-feed").getByTestId("settings-group-head")).toHaveText(
    "Bảng tin",
  );
  await p.getByTestId("settings-nav-feed").click();
  await expect(p.getByTestId("settings-nav-feed")).toHaveAttribute("aria-current", "true");
  await expect(p.getByRole("switch").first()).toBeVisible(); // công tắc thông báo của Bảng tin
  await p.keyboard.press("Escape");

  await p.goto("/community?settings=1");
  await expect(p.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await expect(p.getByTestId("settings-nav-feed")).toHaveAttribute("aria-current", "true");
  await expect(p).toHaveURL(/\/community$/);
  await host.ctx.close();
});

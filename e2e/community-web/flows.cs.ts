// CR-120 · cr120-community-flow-ui · HÀNH TRÌNH THẬT (D5, không mock) trên stack community-web + ai-admin:
//  1. Platform admin ở ai-admin gán quy trình "duyệt bài" cho công ty (đường thật, không bật cờ trong seed).
//  2. Đối tác đăng bài ⇒ "Chờ duyệt" ở Bài đăng của tôi (kèm gợi ý sửa) ⇒ chủ quản thấy mục "Duyệt bài" ⇒ duyệt ⇒ bài hiện trên bảng tin.
// (Không phụ thuộc thứ tự file: ca 3 tự đăng bài riêng rồi báo cáo/ẩn bài đó, không đụng bài mẫu dùng chung.)
//  3. Đối tác báo cáo một bài của chủ quản (menu ⋯) ⇒ chủ quản vào "Báo cáo vi phạm", thấy tiêu đề bài + lý do ⇒ Ẩn bài.
import { expect, test } from "@playwright/test";
import { apiLogin, approvePost, createPost, pageFetch } from "../_kit/api";
import { enableFlowTriggers } from "../_kit/flows";
import { flowRows, loginPlatformAdminUi, openCompanyFlows, openTenantAppsTab } from "../_kit/ui";
import { ensureModerationFlow } from "./_flow";
import { openAs, postByTitle, TENANT, USERNAME } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const OWNER_PW = process.env.DEMO_OWNER_PW ?? "";
const RUN = Date.now().toString(36);
const TITLE = `Keo dan duyet ${RUN}`;
const TENANT_NAME = "Demo Sổ Hợp Tác";

test.describe.configure({ mode: "serial" });

test("1 · platform admin gán quy trình duyệt bài cho công ty (đường thật)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await ensureModerationFlow(); // CR-127 Z7: quản trị nền tảng dựng quy trình công ty từ sơ đồ trống + áp dụng (không còn «Gán» mẫu)
  await loginPlatformAdminUi(
    page,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await openTenantAppsTab(page, TENANT_NAME);
  // CR-122 U2: gán ở công ty › Quy trình = MỘT danh sách flow (không còn việc/ngăn Gán): chọn flow duyệt bài trong Thư viện → Gán
  const box = await openCompanyFlows(page);
  await expect(flowRows(box).filter({ hasText: /bài/i })).not.toHaveCount(0);
  await enableFlowTriggers(TENANT); // G3: cờ FLOW_TRIGGERS bật cho công ty test (bóng → thật)
  await ctx.close();
});

test("2 · đối tác đăng ⇒ Chờ duyệt ⇒ chủ quản duyệt ở Duyệt bài ⇒ bài hiện", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const sup = await openAs(browser, "supplier");
  await sup.page.goto("/community");
  await sup.page
    .getByTestId("composer")
    .getByRole("button", { name: /đang có hàng/ })
    .click();
  await sup.page
    .getByTestId("composer")
    .getByRole("button", { name: "Cần bán", exact: true })
    .click();
  await sup.page.getByLabel("Hàng hoá", { exact: true }).fill(TITLE);
  await sup.page.getByLabel("Số lượng").fill("3 thùng");
  await sup.page.getByRole("button", { name: "Đăng bài" }).click();

  // Bài của tôi: "Chờ duyệt" + lý do/bước kế + gợi ý sửa
  await sup.page.goto("/community/profile");
  const mine = postByTitle(sup.page, TITLE);
  // FLOW_TRIGGERS bật: bài mở lượt qua bộ điều phối (≤ vài giây) ⇒ nhãn hiện sau, không còn đồng bộ như đường khe cũ
  await expect(async () => {
    await sup.page.reload();
    await expect(mine.getByTestId("mod-label")).toHaveText("Đang chờ duyệt", { timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  await expect(mine.getByTestId("mod-hint")).toHaveText("Sửa nội dung sẽ gửi duyệt lại.");

  // Chủ quản: có mục "Duyệt bài" (khe đã bật), bài nằm trong hàng chờ, duyệt
  const host = await openAs(browser, "host");
  await host.page.goto("/community");
  await expect(host.page.getByTestId("nav-community-review")).toBeVisible();
  await host.page.getByTestId("nav-community-review").click();
  const item = host.page.getByTestId("review-item").filter({ hasText: TITLE });
  await expect(async () => {
    await host.page.reload();
    await expect(item.getByTestId("review-approve")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 240_000 });
  await item.getByTestId("review-approve").click();
  await expect(item).toHaveCount(0);

  await host.page.goto("/community");
  await expect(postByTitle(host.page, TITLE).first()).toBeVisible();
  await sup.page.goto("/community/profile");
  await expect(postByTitle(sup.page, TITLE).getByTestId("mod-label")).toHaveText("Đã đăng");
  await sup.ctx.close();
  await host.ctx.close();
});

test("3 · đối tác báo cáo một bài ⇒ chủ quản Ẩn bài ở Báo cáo vi phạm", async ({ browser }) => {
  // Bài RIÊNG của ca này: chủ quản đăng thông báo (mọi bạn bè thấy) có mã chạy duy nhất; ca không đụng bài mẫu dùng chung.
  test.setTimeout(420_000);
  const NOTE = `Thông báo kiểm thử ${RUN}`;
  // Đăng bằng API (audience "all" tường minh như seed): ca này kiểm luồng báo cáo, không kiểm ô soạn bài.
  const hostPage = await openAs(browser, "host"); // trang cùng origin: gọi API qua trình duyệt (Node không nối thẳng origin web)
  const hostApi = await apiLogin({
    fx: pageFetch(hostPage.page),
    base: "",
    tenantKey: TENANT,
    username: USERNAME.host,
    password: OWNER_PW,
    app: "contracts",
  });
  const note = await createPost("", hostApi, { type: "note", body: NOTE });
  expect(note.id, "createPost phải trả id bài").toBeTruthy();
  // bật duyệt bài ⇒ bài của chủ quản cũng phải duyệt; bước duyệt mở sau bước kiểm tra của hệ thống (FLOW_TASK_NOT_OPEN tới lúc đó)
  await expect(async () => {
    await approvePost("", hostApi, note.id as string);
  }).toPass({ timeout: 200_000 });
  await hostPage.ctx.close();
  const hostPostText = "(đăng bằng API)";
  const needsReview = true;
  const buyer = await openAs(browser, "buyer");
  await buyer.page.goto("/community");
  const target = postByTitle(buyer.page, NOTE).first();
  // Duyệt bài (ca 1) có thể giữ bài mới ở "Chờ duyệt" một lúc ⇒ tải lại tới khi bài tới người mua.
  await expect(async () => {
    await buyer.page.reload();
    await expect(
      target,
      `bài của chủ quản (needsReview=${needsReview}): ${hostPostText}`,
    ).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  await target.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await target.getByTestId("post-report").click();
  const dlg = buyer.page.getByTestId("report-dialog");
  await dlg.getByTestId("reason-submit").click();
  await expect(dlg.getByTestId("reason-error")).toBeVisible(); // thiếu lý do ⇒ nói cách sửa
  await dlg.getByTestId("reason-input").fill(`Nội dung không phù hợp ${RUN}`);
  await dlg.getByTestId("reason-submit").click();
  await expect(dlg).toHaveCount(0);

  const host = await openAs(browser, "host");
  await host.page.goto("/community");
  await host.page.getByTestId("nav-community-reports").click();
  const rep = host.page
    .getByTestId("report-item")
    .filter({ hasText: `Nội dung không phù hợp ${RUN}` });
  await expect(rep).toBeVisible();
  await rep.getByTestId("report-hide").click();
  await expect(rep.getByTestId("report-hide")).toHaveCount(0);
  await buyer.ctx.close();
  await host.ctx.close();
});

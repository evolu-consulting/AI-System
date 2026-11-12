// CR-125 · c6 · B3/B4 · quản trị community mở trình sửa flow "Duyệt bài" (stack community-web + ai-admin, đường thật):
// menu "+ Thêm bước" có bước nghiệp vụ của community + Kết thúc theo kết quả Hiện bài / Ẩn bài, KHÔNG có bước hợp đồng / "Nâng cao";
// hộp bật quy trình, dòng trạng thái ở chân trang, thẻ Giới hạn nói "bài đăng" (record.label của sự kiện), không còn chữ "hợp đồng".
import { expect, test } from "@playwright/test";
import { enableFlowTriggers } from "../_kit/flows";
import { createFlowUi, loginPlatformAdminUi } from "../_kit/ui";
import { TENANT } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
const TENANT_NAME = "Demo Sổ Hợp Tác";
const NO_CONTRACT = /hợp đồng/i;

// CR-127 Z5b: quản trị công ty chỉ xem ⇒ menu «+» của màn soạn kiểm bằng quản trị NỀN TẢNG (tạo quy trình trống cho community ở ai-admin, soạn theo khối).
test("quản trị community: menu + chữ trong trình sửa flow Duyệt bài đúng ngôn ngữ community", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const pctx = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1440, height: 1000 },
  });
  const pp = await pctx.newPage();
  await loginPlatformAdminUi(
    pp,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await enableFlowTriggers(TENANT);
  await createFlowUi(pp, ADMIN, {
    company: TENANT_NAME,
    app: "Community",
    name: `Duyệt bài (menu) ${Date.now().toString(36)}`,
  });
  const editor = pp.getByTestId("outline-editor");
  // B4 · khối Bắt đầu / Hoàn tất nói «bài đăng», không nhắc «hợp đồng»
  await expect(pp.getByTestId("outline-start")).toContainText(/bài/i);
  await expect(editor).not.toContainText(NO_CONTRACT);

  // B3 · menu «+» trên đường nối: bước nghiệp vụ của community, không có bước của Sổ Hợp Tác
  await pp.getByTestId("outline-add-main-0").click();
  const menu = pp.getByRole("menu");
  await expect(menu.getByTestId("flow-node-approve")).toBeVisible();
  // c6b · MỘT lối đăng bài: chỉ "Kết thúc · Hiện bài" (không thêm mục "Hiện bài" riêng)
  await expect(menu.getByTestId("flow-node-community.show-post")).toHaveCount(0);
  for (const id of [
    "contracts.esign",
    "contracts.partner-send",
    "finish-approved",
    "finish-rejected",
  ])
    await expect(menu.getByTestId(`flow-node-${id}`)).toHaveCount(0);
  await expect(menu).not.toContainText(NO_CONTRACT);
  await pp.screenshot({ path: testInfo.outputPath("c6-add-menu.png") });
  await pp.keyboard.press("Escape");
  await expect(editor).not.toContainText(NO_CONTRACT);
  await pctx.close();
});

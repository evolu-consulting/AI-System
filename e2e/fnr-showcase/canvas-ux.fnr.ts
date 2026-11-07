// CR-122 · p22 · canvas-ux · e2e trên flow mẫu "Duyệt đề nghị chi" (0 Nhập · 1 Pháp chế + Kế toán · 2 Kiểm tra hạn mức (Nếu) · 3 Giám đốc · 4 Hoàn tất):
// (1) kéo cổng "Sai" của node Nếu sang "Giám đốc duyệt" ⇒ ô "Sai thì tới bước" đổi ngay và các ô chọn bước hiện "Bước N · tên";
// (2) kéo về bước đứng trước ⇒ không đổi gì, có câu báo lý do; (3) platform_admin đặt số bước tối đa = số bước hiện có ⇒ "Thêm bước" tắt + chú thích.
// Không lưu flow (chỉ sửa bản nháp). Ảnh chụp: docs/specs/cr122-p22-canvas-ux/shots/. Chạy: xem `playwright.fnr.config.ts`.
import { FLOW_SHOWCASE_KEY } from "@ai/contracts/hub-admin";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, settle } from "../P-a/_pa-support";
import { canvas, defByKey, node } from "../P-b2/_pb2-support";

test.afterEach(() => settle());

const SHOTS = "docs/specs/cr122-p22-canvas-ux/shots";

async function open(p: Page): Promise<void> {
  await adminLogin(p);
  const d = await defByKey(FLOW_SHOWCASE_KEY);
  await p.goto(`${ADMIN_URL}/processes/${d.id}`);
  await expect(canvas(p)).toBeVisible();
  await expect(node(p, "Giám đốc duyệt")).toBeVisible();
}

/** Kéo bằng chuột thật từ giữa `from` tới giữa `to` (xyflow cần các bước di chuyển trung gian). */
async function drag(p: Page, from: Locator, to: Locator): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await to.boundingBox()))
    .toBe(JSON.stringify(await to.boundingBox())); // canvas đã fit xong
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("không thấy cổng hoặc node đích");
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await p.mouse.up();
}

test("CR-122 · p22 · kéo cổng Sai của node Nếu sang bước sau ⇒ ô 'Sai thì tới bước' đổi ngay, các ô chọn hiện 'Bước N · tên'", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await open(p);
    await drag(p, canvas(p).getByTestId("port-no"), node(p, "Giám đốc duyệt"));
    await p.getByRole("button", { name: "Sắp xếp" }).click();
    await canvas(p).getByTestId("if-node").click();
    const field = p.getByRole("combobox", { name: "Sai thì tới bước" });
    await expect(field).toContainText("Bước 4 · Giám đốc duyệt");
    await field.click();
    await expect(p.getByRole("option", { name: "Bước 5 · Hoàn tất" })).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/picker-named-steps.png` });
    await p.keyboard.press("Escape");
  } finally {
    await ctx.close();
  }
});

test("CR-122 · p22 · kéo về bước đứng trước ⇒ không đổi gì và có câu báo lý do", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await open(p);
    await drag(p, canvas(p).getByTestId("port-next").nth(1), node(p, "Nhập đề nghị"));
    await expect(p.getByText("Chỉ nối được tới bước đứng sau.")).toBeVisible();
    await expect(p.getByText("Có thay đổi chưa lưu")).toHaveCount(0);
    await p.screenshot({ path: `${SHOTS}/connect-rejected.png` });
  } finally {
    await ctx.close();
  }
});

test("CR-122 · p22 · số bước tối đa là cài đặt nền tảng: đặt = số bước hiện có ⇒ 'Thêm bước' tắt kèm chú thích; khôi phục 22", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/system-health`);
    const box = p.getByTestId("process-limit");
    const input = box.getByTestId("process-stages-max");
    await expect(input).toHaveValue("22");
    await input.fill("6");
    await box.getByRole("button", { name: "Lưu" }).click();
    await expect(p.getByText("Đã lưu giới hạn quy trình")).toBeVisible();
    await box.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/platform-setting.png` });
    const d = await defByKey(FLOW_SHOWCASE_KEY);
    await p.goto(`${ADMIN_URL}/processes/${d.id}`);
    const add = p.getByTestId("flow-add-step");
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute("title", /tối đa 6 bước/);
    await p.screenshot({ path: `${SHOTS}/add-disabled.png` });
  } finally {
    // dọn: trả về mặc định để các ca khác không bị chặn
    await p.goto(`${ADMIN_URL}/system-health`);
    const input = p.getByTestId("process-limit").getByTestId("process-stages-max");
    await input.fill("22");
    await p.getByTestId("process-limit").getByRole("button", { name: "Lưu" }).click();
    await expect(input).toHaveValue("22");
    await ctx.close();
  }
});

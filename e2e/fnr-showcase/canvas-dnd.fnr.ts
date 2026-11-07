// CR-123 · p25 · FLOW3-FR-05..08 · e2e canvas sửa tay trên flow mẫu "Duyệt đề nghị chi" (0 Nhập · 1 Pháp chế + Kế toán · 2 Kiểm tra hạn mức (Nếu) ·
// 3 Giám đốc · 4 Hoàn tất): nối lại đầu cạnh (hợp lệ / sai ⇒ toast nêu lý do), Delete + Ctrl+Z khôi phục, chọn nhiều + Ctrl+C/V, minimap, bảng phím tắt.
// Thả từ bảng mẫu (FR-04) cần trình soạn flow có node "Bắt đầu khi" (bảng node theo manifest) — flow mẫu này không có, nên phần đó được test ở
// lib/canvas-edit.test.ts (placeFresh, insertOnEdge). Không lưu flow. Ảnh: .data/p25-shots/ (evotest tự gom về log), chép vào docs/specs/CR-123/shots/p25-*.
import { FLOW_SHOWCASE_KEY } from "@ai/contracts/hub-admin";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, settle } from "../P-a/_pa-support";
import { canvas, defByKey, node } from "../P-b2/_pb2-support";

test.afterEach(() => settle());
test.use({ viewport: { width: 1440, height: 900 } });

const SHOTS = ".data/p25-shots";

async function open(p: Page): Promise<void> {
  await adminLogin(p);
  const d = await defByKey(FLOW_SHOWCASE_KEY);
  await p.goto(`${ADMIN_URL}/processes/${d.id}`);
  await expect(canvas(p)).toBeVisible();
  await expect(node(p, "Giám đốc duyệt")).toBeVisible();
  await canvas(p).scrollIntoViewIfNeeded();
}

const live = (p: Page, text: string) => p.getByRole("status").filter({ hasText: text });
const uidOf = async (p: Page, name: string): Promise<string> =>
  (await node(p, name).getAttribute("data-stage-uid")) ?? "";
const edgeOf = (p: Page, id: string) => canvas(p).getByTestId(`rf__edge-${id}`);

/** Toạ độ màn hình của điểm cách đầu cạnh 25% chiều dài (tránh nút "+" ở giữa cạnh). */
async function edgePoint(p: Page, id: string, at: number): Promise<{ x: number; y: number }> {
  return edgeOf(p, id)
    .locator("path")
    .first()
    .evaluate((el, f) => {
      const path = el as SVGPathElement;
      const pt = path.getPointAtLength(path.getTotalLength() * f);
      const m = path.getScreenCTM() as DOMMatrix;
      return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
    }, at);
}

/** Kéo đầu ĐÍCH của cạnh `id` thả lên giữa node `to` (chuột thật, nhiều bước trung gian). */
async function reconnect(p: Page, id: string, to: string): Promise<void> {
  const anchor = edgeOf(p, id).locator("circle.react-flow__edgeupdater-target");
  const a = await anchor.boundingBox();
  const b = await node(p, to).boundingBox();
  if (!a || !b) throw new Error("không thấy đầu cạnh hoặc node đích");
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await p.mouse.up();
}

async function pane(p: Page): Promise<void> {
  await canvas(p).click({ position: { x: 6, y: 6 } }); // vùng trống: bỏ chọn + đưa focus về canvas
}

test("CR-123 · p25 · nối lại đầu cạnh: Sai sang bước sau đổi đích, cạnh tiến kéo về bước trước ⇒ toast lý do, không đổi gì", async ({
  page: p,
}) => {
  await open(p);
  const noEdge = () => canvas(p).locator('[data-testid^="rf__edge-"][data-testid$="#no"]');
  await expect(canvas(p).locator(".react-flow__minimap")).toBeVisible();
  // hai lần nối lại (Hoàn tất rồi Giám đốc duyệt) ⇒ chắc chắn có một lần khác đích hiện tại
  const id1 = (await noEdge().first().getAttribute("data-testid"))?.replace("rf__edge-", "") ?? "";
  await reconnect(p, id1, "Hoàn tất");
  const id2 = (await noEdge().first().getAttribute("data-testid"))?.replace("rf__edge-", "") ?? "";
  await reconnect(p, id2, "Giám đốc duyệt");
  await expect(live(p, "Đã đặt bước khi Sai.").first()).toBeAttached();
  await p.screenshot({ path: `${SHOTS}/reconnect-ok.png` });

  const g = await uidOf(p, "Giám đốc duyệt");
  const h = await uidOf(p, "Hoàn tất");
  await reconnect(p, `${g}>${h}`, "Nhập đề nghị");
  await expect(
    p.getByRole("alert").filter({ hasText: "Chỉ nối được tới bước đứng sau." }),
  ).toBeVisible();
  await p.screenshot({ path: `${SHOTS}/reconnect-rejected.png` });
});

test("CR-123 · p25 · Delete xoá cạnh/bước, Ctrl+Z và nút Hoàn tác khôi phục, Ctrl+Y làm lại", async ({
  page: p,
}) => {
  await open(p);
  const g = await uidOf(p, "Giám đốc duyệt");
  const noEdge = canvas(p).locator('[data-testid^="rf__edge-"][data-testid$="#no"]').first();
  const id = ((await noEdge.getAttribute("data-testid")) ?? "").replace("rf__edge-", "");
  await reconnect(p, id, "Giám đốc duyệt"); // Sai → Giám đốc (không mặc định) để xoá cạnh có tác dụng
  await pane(p);
  const noId = ((await noEdge.getAttribute("data-testid")) ?? "").replace("rf__edge-", "");
  const pt = await edgePoint(p, noId, 0.3);
  await p.mouse.click(pt.x, pt.y);
  await p.keyboard.press("Delete");
  await expect(live(p, "Đã đặt lại đường nối về bước tiếp theo.").first()).toBeAttached();
  await p.keyboard.press("Control+z");
  await expect(live(p, "Đã hoàn tác.").first()).toBeAttached();

  // xoá một bước: có cấu hình ⇒ hỏi xác nhận; Ctrl+Z đưa bước về
  await node(p, "Hoàn tất").click();
  await p.keyboard.press("Delete");
  const confirm = p.getByRole("alertdialog");
  if (await confirm.isVisible().catch(() => false))
    await confirm.getByRole("button", { name: "Xoá" }).click();
  await expect(node(p, "Hoàn tất")).toHaveCount(0);
  await pane(p);
  await p.screenshot({ path: `${SHOTS}/delete-node.png` });
  await p.keyboard.press("Control+z");
  await expect(node(p, "Hoàn tất")).toBeVisible();
  await p.getByTestId("canvas-redo").click();
  await expect(node(p, "Hoàn tất")).toHaveCount(0);
  await p.getByTestId("canvas-undo").click();
  await expect(node(p, "Hoàn tất")).toBeVisible();
  expect(g).not.toBe("");
});

test("CR-123 · p25 · Shift+nhấn chọn nhiều, Ctrl+C / Ctrl+V nhân đôi (tên + mã mới), bảng phím tắt", async ({
  page: p,
}) => {
  await open(p);
  // nhấn thường mở ngăn chi tiết (che bên phải) ⇒ nhấn thường node bên phải trước, Shift+nhấn node bên trái sau
  await node(p, "Giám đốc duyệt").click();
  await node(p, "Nhập đề nghị").click({ modifiers: ["Shift"] });
  await expect(canvas(p).locator(".react-flow__node.selected")).toHaveCount(2);
  await p.screenshot({ path: `${SHOTS}/multi-select.png` });
  await p.keyboard.press("Control+c");
  await expect(live(p, "Đã chép 2 bước.").first()).toBeAttached();
  await p.keyboard.press("Control+v");
  await expect(live(p, "Đã dán 2 bước").first()).toBeAttached();
  await expect(node(p, "Giám đốc duyệt \\(bản sao\\)")).toBeVisible();
  await expect(node(p, "Nhập đề nghị \\(bản sao\\)")).toBeVisible();
  await p.screenshot({ path: `${SHOTS}/pasted.png` });

  await p.getByRole("button", { name: "Phím tắt" }).click();
  await expect(p.getByText("Ctrl+Z: hoàn tác")).toBeVisible();
  await p.screenshot({ path: `${SHOTS}/shortcuts.png` });
});

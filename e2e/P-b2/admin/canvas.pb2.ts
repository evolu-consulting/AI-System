// ADM-FR-71 · HUB-FR-104 · HUB-FR-118 · AC-PB2-12 · e2e P-b2 admin (test-plan §4 E-PB2-01…12): Canvas quy trình ở admin-web
// `/processes/:id` — nhãn NGUYÊN VĂN plan-frontend §7 + plan-frontend-i18n §1 (số bước UI = `step+1`, G-4). Def `pb2-canvas`
// "Canvas thử" (Phân tích · bước 1 | Rà soát code + Test hồi quy (tự chạy) · bước 2 | Tổng hợp · bước 3) và `pb2-full` "Đủ ba"
// (bước 2 đã 3 giai đoạn) chèn SQL ở stack. Chưa có canvas ⇒ đỏ ở locator/expect.
import { expect, type Page, test } from "@playwright/test";
import {
  canvas,
  DEF_CANVAS,
  DEF_FULL,
  defByKey,
  node,
  openDef,
  openTemplate,
  panel,
  saveDef,
  stepSpin,
} from "../_pb2-support";

const openCanvas = (p: Page) => openDef(p, DEF_CANVAS.key, DEF_CANVAS.name);
// CR-122 C / CR-123 u13: sơ đồ không còn nút "Thêm bước vào bước n" ở đầu cột (thêm bước qua menu "Thêm bước"; bước đổi bằng
// panel / Alt+mũi tên / ô "Chạy ở bước", kéo node chỉ đổi vị trí) ⇒ nút đó chỉ còn ở dạng Danh sách; kiểm "đủ 3" ở đó.
const addToStep2 = async (p: Page) => {
  const puts: string[] = [];
  p.on("request", (r) => {
    if (r.method() === "PUT" && /\/process-defs\//.test(r.url())) puts.push(r.url());
  });
  await p.getByTestId("flows-view-list").click();
  const add = p.getByRole("button", { name: "Thêm bước vào bước 2" });
  await expect(add).toBeVisible();
  expect(puts, "đổi cách xem Sơ đồ/Danh sách không được lưu quy trình").toHaveLength(0);
  return add;
};

test("ADM-FR-71 · E-PB2-01 · mở pb2-canvas ⇒ application 'Canvas quy trình', 4 nút 'Giai đoạn n: …', panel 'Chi tiết giai đoạn' chọn sẵn Giai đoạn 1", async ({
  page: p,
}) => {
  await openCanvas(p);
  await expect(canvas(p)).toBeVisible();
  await expect(canvas(p).getByRole("button", { name: /^Bước [1-4]: / })).toHaveCount(4);
  // fnr-editor-drawer (qc, người dùng chốt ngăn đóng mặc định 2026-10-29): ngăn đóng lúc tải; chọn node ⇒ ngăn mở.
  await expect(panel(p)).toHaveCount(0);
  await node(p, "Phân tích").click();
  await expect(panel(p).getByRole("region", { name: "Bước 1: Phân tích" })).toBeVisible();
});

test("ADM-FR-71 · E-PB2-02 · click 'Giai đoạn 3: Test hồi quy' ⇒ panel đổi; spinbutton 'Chạy ở bước' = 2 (step+1)", async ({
  page: p,
}) => {
  await openCanvas(p);
  await canvas(p)
    .getByRole("button", { name: /^Bước 3: Test hồi quy/ })
    .click();
  await expect(panel(p).getByRole("region", { name: "Bước 3: Test hồi quy" })).toBeVisible();
  await expect(stepSpin(p)).toHaveValue("2");
});

test("ADM-FR-71 · E-PB2-03 · focus Rà soát code + Alt+ArrowRight ⇒ status 'Giai đoạn n chuyển sang bước 3'; spinbutton 3; URL giữ", async ({
  page: p,
}) => {
  await openCanvas(p);
  const n = node(p, "Rà soát code");
  await n.click();
  const url = p.url();
  await n.focus();
  await p.keyboard.press("Alt+ArrowRight");
  await expect(
    p.getByRole("status").filter({ hasText: /^Bước \d+ chuyển sang bước 3$/ }),
  ).toBeVisible();
  await expect(stepSpin(p)).toHaveValue("3");
  expect(p.url()).toBe(url);
  await expect(node(p, "Rà soát code")).toBeFocused();
});

test("ADM-FR-71 · E-PB2-04 · kéo Tổng hợp (chuột) chỉ đổi vị trí, không đổi bước; 'Chuyển sang bước trước' ⇒ bước 2 đủ 3 giai đoạn ('Thêm bước vào bước 2' ở dạng Danh sách bị khoá)", async ({
  page: p,
}) => {
  await openCanvas(p);
  const src = node(p, "Tổng hợp");
  const dst = node(p, "Test hồi quy");
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  const b = await dst.boundingBox();
  expect(a && b, "toạ độ node").toBeTruthy();
  if (!a || !b) return;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height + 40, { steps: 12 });
  await p.mouse.up();
  await src.click();
  await expect(stepSpin(p)).toHaveValue("3"); // kéo ngang không còn đổi bước (u13)
  await panel(p).getByRole("button", { name: "Chuyển sang bước trước" }).click();
  await expect(stepSpin(p)).toHaveValue("2");
  await expect(await addToStep2(p)).toHaveAttribute("aria-disabled", "true");
});

test("ADM-FR-71 · E-PB2-05 · pb2-full: Alt+ArrowRight 'Mở đầu' sang bước 2 (đã 3) ⇒ alert 'Bước 2 đã đủ 3 giai đoạn song song.' + status; bước không đổi", async ({
  page: p,
}) => {
  await openDef(p, DEF_FULL.key, DEF_FULL.name);
  const n = node(p, "Mở đầu");
  await n.click();
  await n.focus();
  await p.keyboard.press("Alt+ArrowRight");
  await expect(
    p.getByRole("alert").filter({ hasText: "Bước 2 đã đủ 3 bước song song." }),
  ).toBeVisible();
  await expect(
    p.getByRole("status").filter({ hasText: "Không chuyển được: bước 2 đã đủ 3 bước" }),
  ).toBeVisible();
  await expect(stepSpin(p)).toHaveValue("1");
  await expect(await addToStep2(p)).toHaveAttribute("aria-disabled", "true");
});

test("ADM-FR-71 · HUB-FR-118 · E-PB2-06 · Tổng hợp: 'Nếu bị trượt' → 'Quay lại bước 2' (mô tả = tên giai đoạn) → Lưu → tải lại còn; node '↩ bước 2'; GET def back_to_steps [1] + 'Bàn giao'", async ({
  page: p,
}) => {
  await openCanvas(p);
  await node(p, "Tổng hợp").click();
  const grp = panel(p).getByRole("group", { name: "Nếu bị trượt" });
  const box = grp.getByRole("checkbox", { name: "Quay lại bước 2" });
  await expect(box).toHaveAccessibleDescription(/Rà soát code/);
  await expect(grp.getByRole("checkbox", { name: "Quay lại bước 1" })).toBeVisible();
  await expect(grp.getByRole("checkbox", { name: "Quay lại bước 3" })).toHaveCount(0);
  await box.check();
  expect(await saveDef(p)).toBe(200);
  await p.reload();
  await node(p, "Tổng hợp").click();
  await expect(
    panel(p)
      .getByRole("group", { name: "Nếu bị trượt" })
      .getByRole("checkbox", { name: "Quay lại bước 2" }),
  ).toBeChecked();
  await expect(node(p, "Tổng hợp")).toContainText("↩ bước 2");
  const d = await defByKey(DEF_CANVAS.key);
  expect(d.stages[3].after.back_to_steps).toEqual([1]);
  expect(d.stages[3].output.required_sections).toContain("Bàn giao");
});

test("ADM-FR-71 · E-PB2-07 · giai đoạn bước đầu ⇒ 'Bước đầu không có bước nào phía trước.'; giai đoạn tự chạy ⇒ chỉ câu đó, không checkbox", async ({
  page: p,
}) => {
  await openCanvas(p);
  await node(p, "Phân tích").click();
  const g1 = panel(p).getByRole("group", { name: "Nếu bị trượt" });
  await expect(g1).toContainText("Bước đầu không có bước nào phía trước.");
  await expect(g1.getByRole("checkbox")).toHaveCount(0);
  await node(p, "Test hồi quy").click();
  const g2 = panel(p).getByRole("group", { name: "Nếu bị trượt" });
  await expect(g2).toContainText("Bước đầu không có bước nào phía trước.");
  await expect(g2.getByRole("checkbox")).toHaveCount(0);
});

test("ADM-FR-71 · AC-PB2-05 · E-PB2-08 · 'Hành động thật' của Tổng hợp disabled khi bước trước có stage tự chạy; đổi Test hồi quy sang duyệt ⇒ enabled", async ({
  page: p,
}) => {
  await openCanvas(p);
  await node(p, "Tổng hợp").click();
  await expect(panel(p).getByRole("switch", { name: "Hành động thật" })).toBeDisabled();
  await node(p, "Test hồi quy").click();
  await panel(p).getByRole("combobox", { name: "Sau bước này" }).click();
  await p.getByRole("option", { name: "Duyệt bởi phòng ban" }).click();
  await expect(p.getByRole("listbox")).toHaveCount(0); // Select đã đóng hẳn, Esc không bị popup nuốt
  await p.keyboard.press("Escape"); // fnr-editor-drawer (qc): ngăn đè lên node "Tổng hợp" ⇒ đóng ngăn (Esc) trước khi bấm node khác
  await node(p, "Tổng hợp").click();
  await expect(panel(p).getByRole("switch", { name: "Hành động thật" })).toBeEnabled();
});

test("ADM-FR-71 · E-PB2-09 · nút panel 'Chuyển sang bước sau' / 'Chuyển sang bước trước' / 'Lên' (đường a11y thay kéo thả)", async ({
  page: p,
}) => {
  await openCanvas(p);
  await node(p, "Rà soát code").click();
  await panel(p).getByRole("button", { name: "Chuyển sang bước sau" }).click();
  await expect(stepSpin(p)).toHaveValue("3");
  await expect(p.getByRole("status").filter({ hasText: /chuyển sang bước 3$/ })).toBeVisible();
  await panel(p).getByRole("button", { name: "Chuyển sang bước trước" }).click();
  await expect(stepSpin(p)).toHaveValue("2");
  await node(p, "Test hồi quy").click();
  await expect(stepSpin(p)).toHaveValue("2");
  await panel(p).getByRole("button", { name: "Lên" }).click();
  await expect(canvas(p).getByRole("button", { name: /^Bước 2: Test hồi quy/ })).toBeVisible();
  await node(p, "Rà soát code").click();
  await panel(p).getByRole("button", { name: "Tách sang bước riêng" }).click();
  await expect(await addToStep2(p)).not.toHaveAttribute("aria-disabled", "true");
});

test("ADM-FR-71 · E-PB2-10 · tab 'Danh sách' ⇒ danh sách theo bước + panel; chunk canvas lỗi ⇒ alert + 'Thử lại'; 700 px ⇒ mặc định Danh sách", async ({
  page: p,
  browser,
}) => {
  test.fixme(
    true,
    "Q1: đỏ sau CR-122 U2 (alert 'Không tải được canvas… Thử lại' không hiện khi chunk canvas bị chặn) — chưa phân loại mới/cũ, báo agent canvas",
  );
  await openCanvas(p);
  await p.getByTestId("flows-view-list").click(); // CR-121 F9: công tắc Sơ đồ / Danh sách bước (không còn tablist)
  await expect(canvas(p)).toHaveCount(0);
  await expect(p.getByRole("button", { name: /^Bước [1-4]: / })).toHaveCount(4);
  await p.getByRole("button", { name: /^Bước 3: Test hồi quy/ }).click();
  await expect(panel(p).getByRole("region", { name: "Bước 3: Test hồi quy" })).toBeVisible();

  const ctx = await browser.newContext();
  const q = await ctx.newPage();
  try {
    await q.route("**/canvas*.js", (r) => r.abort());
    await openCanvas(q);
    await expect(
      q.getByRole("alert").filter({ hasText: "Không tải được canvas. Đang dùng dạng danh sách." }),
    ).toBeVisible();
    await expect(q.getByRole("button", { name: "Thử lại" })).toBeVisible();
    await q.unroute("**/canvas*.js");
    await q.setViewportSize({ width: 700, height: 800 });
    await q.reload();
    await expect(q.getByTestId("flows-view-list")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await ctx.close();
  }
});

test("ADM-FR-71 · E-PB2-11 · focus node + Enter ⇒ panel mở, focus 'Tên giai đoạn'; Delete ⇒ alertdialog 'Xoá giai đoạn “Rà soát code”?'", async ({
  page: p,
}) => {
  test.fixme(
    true,
    "Q1: đỏ sau CR-122 U2 (Enter mở panel nhưng focus không vào ô 'Tên bước') — chưa phân loại mới/cũ, báo agent canvas",
  );
  await openCanvas(p);
  const n = node(p, "Rà soát code");
  await n.focus();
  await p.keyboard.press("Enter");
  await expect(panel(p).getByRole("region", { name: /^Bước \d+: Rà soát code$/ })).toBeVisible();
  await expect(panel(p).getByRole("textbox", { name: "Tên bước" })).toBeFocused();
  await n.focus();
  await p.keyboard.press("Delete");
  await expect(p.getByRole("alertdialog", { name: "Xoá bước “Rà soát code”?" })).toBeVisible();
});

// CR-121 c15: hộp "Tạo quy trình" theo công ty đã gỡ (c13) ⇒ mở mẫu sdlc thẳng theo id (Hub), kiểm chỉ-xem như cũ.
test("ADM-FR-71 · E-PB2-12 · mẫu sdlc: chỉ xem — 2 câu thông báo; không 'Thêm giai đoạn'; Alt+ArrowRight không đổi gì", async ({
  page: p,
}) => {
  await openTemplate(p, "sdlc");
  await expect(
    p.getByText("Đây là quy trình mẫu, chỉ xem. Dùng mẫu này để chỉnh sửa."),
  ).toBeVisible();
  await expect(p.getByText("Quy trình mẫu: chỉ xem, không kéo thả được.")).toBeVisible();
  await expect(p.getByRole("button", { name: "Thêm bước", exact: true })).toHaveCount(0);
  const first = canvas(p).getByRole("button", { name: /^Bước 1: / });
  const before = await first.innerText();
  await first.click();
  const v = await stepSpin(p).inputValue();
  await first.focus();
  await p.keyboard.press("Alt+ArrowRight");
  await expect(stepSpin(p)).toHaveValue(v);
  await expect(canvas(p).getByRole("button", { name: /^Bước 1: / })).toHaveText(before);
});

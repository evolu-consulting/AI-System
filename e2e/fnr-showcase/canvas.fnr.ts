// CR-103 · fnr-canvas · e2e canvas editor `/processes/:id` trên flow mẫu "Duyệt đề nghị chi" (seed của config fnr):
// (1) kéo node theo chiều dọc ⇒ Lưu ⇒ tải lại giữ vị trí (`ui.y` tới Hub); (2) bấm "Sắp xếp" ⇒ node nhánh Đúng ("Giám đốc duyệt")
// nằm làn trên so với node If, nhánh Sai đi thẳng; lưu lại ⇒ `ui` bị xoá (dọn trạng thái cho ca sau).
// Chạy: `bunx playwright test -c e2e/fnr-showcase/playwright.fnr.config.ts --reporter=line` (xem `playwright.fnr.config.ts`).
import { FLOW_SHOWCASE_KEY } from "@ai/contracts/hub-admin";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, settle } from "../P-a/_pa-support";
import { canvas, defByKey, node, saveDef } from "../P-b2/_pb2-support";

test.afterEach(() => settle());

const DIRECTOR = "Giám đốc duyệt"; // nhánh Đúng của node If
const LEGAL = "Pháp chế";
const ACCOUNTING = "Kế toán"; // cột 2, luôn nằm trong khung nhìn của editor (Giám đốc ở mép phải, bị cắt ở màn hẹp)

async function open(p: Page): Promise<void> {
  await adminLogin(p);
  const d = await defByKey(FLOW_SHOWCASE_KEY);
  await p.goto(`${ADMIN_URL}/processes/${d.id}`);
  await expect(canvas(p)).toBeVisible();
  await expect(node(p, DIRECTOR)).toBeVisible();
}
/** `y` của node so với đỉnh khung canvas (không phụ thuộc cuộn trang). */
const topOf = async (loc: ReturnType<typeof node>): Promise<number> => {
  const b = await loc.boundingBox();
  const c = await loc.page().getByRole("application", { name: "Canvas quy trình" }).boundingBox();
  expect(b && c, "toạ độ node").toBeTruthy();
  return (b as { y: number }).y - (c as { y: number }).y;
};
/** Chờ canvas fit xong (animation fitView) — toạ độ node hết đổi — rồi trả hộp; kéo khi đang trôi sẽ trượt node và pan nền. */
async function settledBox(loc: ReturnType<typeof node>) {
  let last = "";
  await expect
    .poll(async () => {
      const cur = JSON.stringify(await loc.boundingBox());
      const same = cur === last;
      last = cur;
      return same;
    })
    .toBe(true);
  return (await loc.boundingBox()) as { x: number; y: number; width: number; height: number };
}
const stageOf = (d: { stages: { name: string; ui?: { y: number } }[] }, name: string) =>
  d.stages.find((s) => s.name === name);

test("CR-103 · fnr-canvas · kéo node theo chiều dọc ⇒ Lưu ⇒ tải lại vẫn giữ vị trí; không đổi bước", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await open(p);
    const n = node(p, ACCOUNTING);
    await n.scrollIntoViewIfNeeded();
    const b = await settledBox(n);
    const y0 = await topOf(n);
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 110, { steps: 12 });
    await p.mouse.up();
    const y1 = await topOf(n);
    expect(y1 - y0, "node đi theo chuột (dọc)").toBeGreaterThan(40);
    // So khoảng cách tới node cùng cột (không đổi theo cuộn/fit của khung nhìn).
    const gapOf = async () => (await topOf(node(p, ACCOUNTING))) - (await topOf(node(p, LEGAL)));
    await expect(p.getByText("Có thay đổi chưa lưu")).toBeVisible();
    const gap1 = await gapOf();
    await expect(p.getByText("Có thay đổi chưa lưu")).toBeVisible(); // thả chuột đã ghi vào bản nháp
    expect(await saveDef(p)).toBe(200);
    const saved = stageOf(await defByKey(FLOW_SHOWCASE_KEY), ACCOUNTING);
    expect(saved?.ui?.y, "ui.y đã lưu ở Hub").toBeGreaterThan(0);
    await p.reload();
    await expect(canvas(p)).toBeVisible();
    await settledBox(node(p, ACCOUNTING));
    expect(Math.abs((await gapOf()) - gap1), "sau tải lại giữ vị trí").toBeLessThan(8);
    await expect(p.getByText(/^Đã lưu/)).toBeVisible(); // không còn thay đổi chưa lưu
  } finally {
    await ctx.close();
  }
});

test("CR-103 · fnr-canvas · 'Sắp xếp' ⇒ nhánh Đúng làn trên, nhánh Sai đi thẳng; lưu ⇒ bỏ ui", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await open(p);
    await p.getByRole("button", { name: "Sắp xếp" }).click();
    const ifNode = canvas(p).getByTestId("if-node");
    await expect(ifNode).toBeVisible();
    await expect(async () => {
      const [yes, main] = [await topOf(node(p, DIRECTOR)), await topOf(ifNode)];
      expect(yes, "Đúng ở làn trên node If").toBeLessThan(main - 40);
    }).toPass();
    await expect(canvas(p).getByTestId("if-edge-yes")).toBeVisible();
    await expect(canvas(p).getByTestId("if-edge-no")).toBeVisible();
    // Dọn: nếu ca trước để lại ui.y thì Lưu ghi đè bỏ ui; nếu không có gì đổi, nút Lưu tắt thì bỏ qua.
    const save = p.getByRole("button", { name: "Lưu", exact: true });
    if (await save.isEnabled()) expect(await saveDef(p)).toBe(200);
    const after = await defByKey(FLOW_SHOWCASE_KEY);
    expect(after.stages.filter((s: { ui?: unknown }) => s.ui)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

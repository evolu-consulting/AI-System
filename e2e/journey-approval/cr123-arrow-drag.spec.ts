// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-123 · u8 · KÉO MŨI TÊN bằng chuột thật trong trình sửa flow CỦA CÔNG TY (lỗi người dùng báo: "không kéo mũi tên sang node khác được"):
// thả "Duyệt" đứng riêng ⇒ kéo đầu ra "Ký xong" của Ký số tới nó (dây nối đi theo chuột) ⇒ kéo từ nó tới Kết thúc · Đã duyệt ⇒ "Lưu và áp dụng" thành công.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FLOW_TEMPLATE_INPUTS } from "../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import { approve, enableFlowTriggers, esignNode, finish, notifyCreator } from "../_kit/flows";
import { flowRow, flowRows, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";
import { viStorageState } from "../support/locale-vi";
import { U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const HUB = need("JA_HUB_URL");
const ADMIN = need("JA_ADMIN_URL");
const TENANT_KEY = `e2e-c22-${SFX}`;
const FLOW = `Kéo mũi tên u8 ${SFX}`;
const FLOW12 = `Thứ tự mũi tên u12 ${SFX}`;
const FLOW12B = `Trình tự demo u12b ${SFX}`;

let tenantId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  // dựng bằng tay (khác `createLibraryFlow`): Ký số cần khai đầu vào `contract_id` của quy trình + nguồn của tham số
  const stages = [
    approve("duyet-dau", "Duyệt trưởng phòng", 0, "pb-ke-toan", { reject: 4 }),
    ...esignNode(1).map((s) =>
      (s as { executor?: { kind?: string } }).executor?.kind === "tool"
        ? {
            ...s,
            executor: {
              kind: "tool",
              tool_key: "contracts-esign-send",
              args: { contract_id: { from: "input", key: "contract_id" } },
            },
          }
        : s,
    ),
    finish("xong", "Đã duyệt", 3, "approved"),
    finish("tu-choi", "Từ chối", 4, "rejected"),
  ];
  tenantId = await enableFlowTriggers(TENANT_KEY);
  await makeFlow(platform, `c23-u8-${SFX}`, FLOW, stages);
  // CR-123 · u12: Kết thúc · Đã duyệt đứng TRƯỚC Thông báo trong thứ tự bước (Ký xong → Thông báo nhảy qua nó)
  const gs = (await (
    await fetch(
      `${need("JA_API_URL")}/admin/users?tenant_id=${tenantId}&q=${U.director}&limit=50`,
      {
        headers: { authorization: `Bearer ${platform.token}` },
      },
    )
  ).json()) as { items: { id: string; username: string }[] };
  await makeFlow(
    platform,
    `c23-u12b-${SFX}`,
    FLOW12B,
    demoBaseline(stages, gs.items.find((u) => u.username === U.director)?.id ?? ""),
  );
  await makeFlow(platform, `c23-u12-${SFX}`, FLOW12, [
    approve("duyet-dau", "Duyệt trưởng phòng", 0, "pb-ke-toan", { reject: 5 }),
    stages[1],
    { ...(stages[2] as object), next_step: 4 },
    finish("xong", "Đã duyệt", 3, "approved"),
    notifyCreator("bao", "Thông báo người tạo", 4, "Đã duyệt"),
    finish("tu-choi", "Từ chối", 5, "rejected"),
  ]);
});
/** Hub bắt buộc có người ký phía công ty khi lưu Ký số (`company_signers` = "loại:id"). */
const withSigner = (s: unknown, group: string) => {
  const x = s as { executor: { args: Record<string, unknown> } };
  return {
    ...x,
    executor: {
      ...x.executor,
      args: {
        ...x.executor.args,
        company_signers: { from: "const", value: `user:${group}` },
      },
    },
  };
};

/** Trưởng phòng duyệt → Ký số → Thông báo chuông → Kết thúc (nền của demo; Ký số cần Duyệt ngay trước nên không chèn Nếu ở giữa). */
const demoBaseline = (stages: readonly unknown[], group: string): unknown[] => [
  approve("duyet-dau", "Duyệt trưởng phòng", 0, "pb-ke-toan", { reject: 5 }),
  withSigner(stages[1], group),
  stages[2],
  notifyCreator("bao", "Thông báo chuông", 3, "Đã duyệt"),
  finish("xong", "Đã duyệt", 4, "approved"),
  finish("tu-choi", "Từ chối", 5, "rejected"),
];
async function makeFlow(
  platform: { token: string },
  key: string,
  name: string,
  stages: readonly unknown[],
): Promise<void> {
  const h = { authorization: `Bearer ${platform.token}`, "content-type": "application/json" };
  const made = await fetch(`${HUB}/process-defs`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      key,
      name,
      description: "",
      input_hint: "Mã hợp đồng",
      run_group_ids: [],
      token_budget: null,
      enabled: true,
      sources: [],
      inputs: FLOW_TEMPLATE_INPUTS,
      stages,
      trigger: { event: "contract.submitted" },
      app: "contracts",
    }),
  });
  if (made.status >= 300)
    throw new Error(`tạo flow: ${made.status} ${(await made.text()).slice(0, 300)}`);
  const def = (await made.json()) as { id: string; version: number };
  const pub = await fetch(`${HUB}/process-defs/${def.id}/publish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ version: def.version, note: "e2e" }),
  });
  if (pub.status >= 300)
    throw new Error(`xuất bản: ${pub.status} ${(await pub.text()).slice(0, 300)}`);
  await assignCompanyFlow(HUB, platform as never, tenantId, def.id);
}
/** Đợi toạ độ đứng yên (fit-view / bố cục có hoạt ảnh) rồi trả hộp; `name` có trong lỗi để biết phần tử nào không đứng yên. */
type Box = { x: number; y: number; width: number; height: number };
async function settled(loc: Locator, name: string): Promise<Box> {
  let prev = "";
  await expect
    .poll(
      async () => {
        const s = JSON.stringify(await loc.boundingBox());
        const same = s === prev;
        prev = s;
        return same;
      },
      { message: `${name}: toạ độ không đứng yên / không thấy (cuối: ${prev})` },
    )
    .toBe(true);
  const b = await loc.boundingBox();
  if (!b) throw new Error(`${name}: không thấy phần tử`);
  return b;
}
/** CR-123 · u13 · điểm TRỐNG trong khung canvas (toạ độ so với khung) để thả node: bố cục ELK đặt node khắp khung, không chừa "dưới đáy" như bố cục cột. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const pane = await settled(
    page.locator(".react-flow__pane").first(),
    "khung canvas (điểm trống)",
  );
  const rects = await page
    .locator(".react-flow__node, .react-flow__minimap, .react-flow__controls")
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
  const stage = rects.find((r) => r.w > 100 && r.h > 60) ?? { w: 240, h: 104 };
  const [w, h] = [stage.w, stage.h];
  for (let cy = pane.y + pane.height - h / 2 - 8; cy > pane.y + h / 2; cy -= h / 2)
    for (let cx = pane.x + w / 2 + 8; cx < pane.x + pane.width - w / 2; cx += w / 2) {
      const hit = rects.some(
        (r) =>
          cx + w / 2 + 12 > r.x &&
          cx - w / 2 - 12 < r.x + r.w &&
          cy + h / 2 + 12 > r.y &&
          cy - h / 2 - 12 < r.y + r.h,
      );
      if (!hit) return { x: cx - pane.x, y: cy - pane.y };
    }
  return { x: w / 2 + 8, y: pane.height - h / 2 - 8 };
}
/** CR-123 · u14 · node nằm TRỌN trong khung canvas (không bị cắt mép): khung nhìn đi theo node vừa thả / vừa nối (đợi hoạt ảnh pan xong). */
async function expectInside(page: Page, loc: Locator, what: string): Promise<void> {
  const pane = page.locator(".react-flow__pane").first();
  await expect
    .poll(
      async () => {
        const [p, b] = [await pane.boundingBox(), await loc.first().boundingBox()];
        return (
          !!p &&
          !!b &&
          b.x >= p.x - 1 &&
          b.y >= p.y - 1 &&
          b.x + b.width <= p.x + p.width + 1 &&
          b.y + b.height <= p.y + p.height + 1
        );
      },
      { message: `${what}: node phải nằm trọn trong khung canvas` },
    )
    .toBe(true);
}
/** Thu nhỏ tới khi node cuối nằm trọn trong khung canvas (đích của mũi tên phải THẤY được mới kéo tới được). */
async function fitAll(page: Page): Promise<void> {
  const pane = page.locator(".react-flow__pane").first();
  const last = page.locator(".react-flow__node").filter({ hasText: "Từ chối" }).last();
  await page.locator(".react-flow__controls-fitview").click();
  for (let i = 0; i < 4; i++) {
    const p = await settled(pane, "khung canvas");
    const l = await settled(last, "node cuối (Từ chối)");
    if (l.x + l.width <= p.x + p.width - 8) return;
    await page.locator(".react-flow__controls-zoomout").click();
  }
}

/** Kéo bằng chuột thật: nhấn ở cổng, đi qua vài điểm, dây nối phải THẤY đi theo chuột trước khi thả. */
async function arrow(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await settled(from, "cổng nguồn của mũi tên");
  const b = await settled(to, "node đích của mũi tên");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 25, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await expect(page.locator(".react-flow__connectionline")).toHaveCount(1);
  await page.mouse.up();
}

test("U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await (
    await browser.newContext({
      locale: "vi-VN",
      storageState: viStorageState([ADMIN]),
      viewport: { width: 1700, height: 1000 },
    })
  ).newPage();
  await loginTenantAdminUi(page, ADMIN, TENANT_KEY, U.director, need("JA_USER_PW"));
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRow(box, FLOW).getByRole("button", { name: "Sao chép để sửa" }).click();
  const copy = flowRows(box).filter({ hasText: `Sao từ ${FLOW} · v1` });
  await expect(copy).toBeVisible();
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.locator("[data-stage-uid]").first()).toBeVisible({ timeout: 30_000 });
  await fitAll(page);

  // 1 · thả "Duyệt" ⇒ node đứng riêng; ngăn chi tiết KHÔNG tự mở (không che các đích của mũi tên)
  const pane = page.locator(".react-flow__pane").first();
  const _pb = await settled(pane, "khung canvas (thả)");
  await page.getByTestId("flow-add-step").click();
  await page
    .getByRole("menuitem", { name: /^Duyệt/ })
    .first()
    .dragTo(pane, { targetPosition: await emptySpot(page), force: true });
  const fresh = page.locator(".react-flow__node").filter({ has: page.getByTestId("free-hint") });
  await expect(fresh).toHaveCount(1);
  await expect(fresh).toContainText("Bước duyệt mới"); // u11 · tên mặc định + nhắc đặt tên (không chỉ "Duyệt")
  await expect(page.getByTestId("free-name-hint")).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: /./ })).toHaveCount(0);
  await expectInside(page, fresh, "sau khi thả Duyệt");
  await fitAll(page); // thả làm canvas fit lại ⇒ thu nhỏ để cả nguồn lẫn đích đều nằm trong khung

  // 2 · kéo đầu ra "Ký xong" của Ký số tới node mới ⇒ nối (node được đặt ngay sau Ký số), hết gợi ý
  const dump = async () =>
    JSON.stringify({
      nodes: await page.locator(".react-flow__node").allInnerTexts(),
      ids: await page
        .locator("[data-testid]")
        .evaluateAll((els) =>
          [...new Set(els.map((e) => e.getAttribute("data-testid")))].slice(0, 40),
        ),
      alerts: await page.getByRole("alert").allInnerTexts(),
    });
  await expect(page.getByTestId("module-exit-done"), await dump()).toHaveCount(1);
  await arrow(page, page.getByTestId("module-exit-done"), fresh);
  await expect(page.getByTestId("free-hint")).toHaveCount(0);
  await expectInside(
    page,
    page.locator(".react-flow__node").filter({ hasText: "Bước duyệt mới" }),
    "sau khi nối Ký xong → Duyệt (ELK bố cục lại)",
  );
  await fitAll(page);

  // 3 · chọn người duyệt cho node mới (Lưu cần), đóng ngăn, rồi kéo từ node mới tới Kết thúc · Đã duyệt
  const node = page
    .locator(".react-flow__node")
    .filter({ has: page.locator("[data-stage-uid]") })
    .filter({ hasText: "Bước duyệt mới" }) // CR-123 · u11: tên mặc định của bước Duyệt vừa thả
    .last();
  await node.locator("[data-stage-uid]").click();
  await page.getByLabel("Ai duyệt").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Đóng ngăn chi tiết" }).click();
  await arrow(
    page,
    node.getByTestId("port-next"),
    page.locator(".react-flow__node").filter({ hasText: "Đã duyệt" }).first(),
  );

  // 4 · Lưu và áp dụng thành công (không toast lỗi, hết nhắc "Chưa áp dụng")
  await page.getByRole("button", { name: /Lưu và áp dụng/ }).click();
  await expect(page.getByText(/Chưa áp dụng/)).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: /Chưa lưu được|chưa được nối/ }),
  ).toHaveCount(0);
});

test("U12 · mũi tên tới bước nằm trước (Thông báo → Kết thúc · Đã duyệt) sắp lại bước, nối ngược bị từ chối vì vòng lặp, Bắt đầu khi → Ký số báo lý do", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await (
    await browser.newContext({
      locale: "vi-VN",
      storageState: viStorageState([ADMIN]),
      viewport: { width: 1700, height: 1000 },
    })
  ).newPage();
  await loginTenantAdminUi(page, ADMIN, TENANT_KEY, U.director, need("JA_USER_PW"));
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRow(box, FLOW12).getByRole("button", { name: "Sao chép để sửa" }).click();
  const copy = flowRows(box).filter({ hasText: `Sao từ ${FLOW12} · v1` });
  await expect(copy).toBeVisible();
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.locator("[data-stage-uid]").first()).toBeVisible({ timeout: 30_000 });
  await fitAll(page);
  const node = (name: string) =>
    page.locator(".react-flow__node").filter({ hasText: name }).first();
  // CR-123 · u14 · bước Kết thúc là điểm cuối: KHÔNG có cổng ra; bước thường có
  await expect(
    page
      .locator(".react-flow__node")
      .filter({ hasText: "Kết thúc" })
      .locator(".react-flow__handle.source"),
  ).toHaveCount(0);
  expect(
    await node("Thông báo người tạo").locator(".react-flow__handle.source").count(),
  ).toBeGreaterThan(0);
  const end = page
    .locator(".react-flow__node")
    .filter({ hasText: "Kết thúc" })
    .filter({ hasText: "Đã duyệt" });
  const alert = (re: RegExp | string) => page.getByRole("alert").filter({ hasText: re });

  // 1 · Kết thúc · Đã duyệt đứng trước Thông báo trong thứ tự bước, KHÔNG phải tổ tiên ⇒ nối được (các bước được sắp lại)
  const [tbId, endId] = [
    await node("Thông báo người tạo").getAttribute("data-id"),
    await end.first().getAttribute("data-id"),
  ];
  await arrow(page, node("Thông báo người tạo").getByTestId("port-next"), end);
  await expect(alert(/Chỉ nối được|vòng lặp/)).toHaveCount(0);
  await fitAll(page);
  await expect(
    page.getByTestId(`rf__edge-${tbId}>${endId}`),
    "mũi tên Thông báo → Kết thúc · Đã duyệt đã nối",
  ).toHaveCount(1);
  // 2 · nối ngược về bước trước (tổ tiên) ⇒ bị từ chối kèm lý do
  await arrow(
    page,
    node("Thông báo người tạo").getByTestId("port-next"),
    node("Duyệt trưởng phòng"),
  );
  await expect(alert("Không nối ngược lại bước trước — sẽ tạo vòng lặp")).toBeVisible();

  // 3 · Bắt đầu khi → Ký số ⇒ toast nêu lý do (Ký số cần bước Duyệt ngay trước)
  await arrow(
    page,
    page.locator(".react-flow__node-trigger").getByTestId("port-next"),
    node("Ký số"),
  );
  await expect(alert(/cần một bước Duyệt ngay trước/)).toBeVisible();
});

test("U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await (
    await browser.newContext({
      locale: "vi-VN",
      storageState: viStorageState([ADMIN]),
      viewport: { width: 1700, height: 1000 },
    })
  ).newPage();
  await loginTenantAdminUi(page, ADMIN, TENANT_KEY, U.director, need("JA_USER_PW"));
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRow(box, FLOW12B).getByRole("button", { name: "Sao chép để sửa" }).click();
  const copy = flowRows(box).filter({ hasText: `Sao từ ${FLOW12B} · v1` });
  await expect(copy).toBeVisible();
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.locator("[data-stage-uid]").first()).toBeVisible({ timeout: 30_000 });
  await fitAll(page);
  const node = (name: string | RegExp) =>
    page.locator(".react-flow__node").filter({ hasText: name }).first();
  const alert = (re: RegExp | string) => page.getByRole("alert").filter({ hasText: re });

  // 1 · thả Duyệt NGAY dưới Thông báo ⇒ rơi vào CỘT của Thông báo; đặt tên + người duyệt
  const pane = page.locator(".react-flow__pane").first();
  const _pb = await settled(pane, "khung canvas (thả)");
  await page.getByTestId("flow-add-step").click();
  await page
    .getByRole("menuitem", { name: /^Duyệt/ })
    .first()
    .dragTo(pane, {
      targetPosition: await emptySpot(page),
      force: true,
    });
  const fresh = page.locator(".react-flow__node").filter({ has: page.getByTestId("free-hint") });
  await expect(fresh).toHaveCount(1);
  await fresh.locator("[data-stage-uid]").click();
  await page.getByLabel("Tên bước", { exact: true }).first().fill("Kế toán duyệt chi");
  await page.getByLabel("Ai duyệt").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Đóng ngăn chi tiết" }).click();
  await fitAll(page);

  // 2 · Ký xong → Kế toán duyệt chi → Thông báo → Kết thúc · Đã duyệt: KHÔNG bị báo vòng lặp / "chỉ nối được tới bước đứng sau"
  const acc = node("Kế toán duyệt chi");
  await arrow(page, page.getByTestId("module-exit-done"), acc);
  await fitAll(page);
  await arrow(page, acc.getByTestId("port-next"), node("Thông báo chuông"));
  await fitAll(page);
  const end = page
    .locator(".react-flow__node")
    .filter({ hasText: "Kết thúc" })
    .filter({ hasText: "Đã duyệt" });
  await arrow(page, node("Thông báo chuông").getByTestId("port-next"), end);
  await expect(alert(/vòng lặp|Chỉ nối được/)).toHaveCount(0);
  await fitAll(page);

  // 3 · Bắt đầu khi → Ký số: cổng ra của Bắt đầu khi nằm trong khung (sau fit) và toast nêu lý do
  const port = page.locator(".react-flow__node-trigger").getByTestId("port-next");
  await arrow(page, port, node("Ký số"));
  await expect(alert(/cần một bước Duyệt ngay trước/).first()).toBeVisible();

  // 4 · Lưu và áp dụng: bước Duyệt đứng một mình ⇒ Hub không trả 422 PROCESS_DEF_INVALID / APPROVE_INVALID
  const failed: string[] = [];
  page.on("response", async (r) => {
    if (r.status() === 422 && r.request().method() !== "GET")
      failed.push(`${r.url()} ${(await r.text()).slice(0, 400)}`);
  });
  await page.getByRole("button", { name: /Lưu và áp dụng/ }).click();
  await expect(page.getByText(/Chưa áp dụng/)).toHaveCount(0);
  expect(failed).toEqual([]);
});

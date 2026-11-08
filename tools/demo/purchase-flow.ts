// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// CR-125 · thử nghiệm quy trình MUA HÀNG 11 bước trên stack UAT local (cổng UAT_PORT_BASE, mặc định 3800).
// Dựng: `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/hub-dev/src/uat-stack.ts` (đợi "UAT STACK READY"; đặt LOGIN_IP_MAX_ATTEMPTS=100000
// cho admin-api vì kịch bản đăng nhập nhiều người một IP). Chạy: `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-flow.ts [build|run|all]`.
//  build: công ty + nhóm + người (API) → quản trị nền tảng: tạo flow Thư viện (mẫu «Duyệt 2 cấp» qua UI), thay bước bằng 20 bước mua hàng,
//         Xuất bản + Gán (UI) → quản trị công ty: Sao chép để sửa (UI), mở canvas, chụp Ngang / Dọc.
//  run:   chạy lượt: `purchase-flow-run.ts` (API hub, nhiều vai) — chạy tới hết bước 7, dừng ở Ký số; xem docs/specs/CR-125/purchase-flow-trial.md.
//  shots <contractId> <tên>: chụp trang Lượt chạy (admin-web).
// Chỉ dữ liệu hư cấu @demo.local; không bí mật (mật khẩu quản trị nền tảng đọc từ SEED_ADMIN_* trong .env.local).
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { ADMIN_USER, DEMO_PW, TENANT } from "./purchase-flow-data";
import { purchaseStages } from "./purchase-flow-def";
import { platformToken, setupTenant, urlsFromBase } from "./purchase-flow-setup";

const u = urlsFromBase();
const SHOTS = process.env.SHOTS_DIR ?? "docs/specs/CR-125/shots/purchase-flow";
const FLOW_NAME = "Quy trình mua hàng (11 dòng)";
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page, tenant: string, user: string, pw: string): Promise<void> {
  await page.goto(`${u.web}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL((x) => !x.pathname.startsWith("/login"));
  await page.waitForTimeout(1500);
}

async function hub(
  path: string,
  tok: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${u.hub}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  return { status: res.status, json: t ? JSON.parse(t) : {} };
}

/** Quản trị nền tảng: nâng trần bước (mặc định 22) rồi tạo flow Thư viện từ mẫu «Duyệt 2 cấp» (UI) và thay bước. */
async function libraryFlow(page: Page, tok: string): Promise<string> {
  await hub("/process-editor/limits", tok, "PUT", { stages_max: 40 });
  const list = await hub("/process-defs?limit=100", tok);
  const hit = (list.json.items as { id: string; name: string }[]).find((d) => d.name === FLOW_NAME);
  let id = hit?.id ?? "";
  if (!id) {
    await page.goto(`${u.web}/processes/0c122000-0000-4000-8000-0000000000b1`); // mẫu «Duyệt 2 cấp»
    await page.getByRole("button", { name: "Dùng mẫu này" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill(FLOW_NAME);
    await page.getByRole("dialog").getByRole("button", { name: "Dùng mẫu này" }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);
    id = page.url().split("/").at(-1) as string;
  }
  const cur = (await hub(`/process-defs/${id}`, tok)).json;
  const put = await hub(`/process-defs/${id}`, tok, "PUT", {
    key: cur.key,
    name: FLOW_NAME,
    description:
      "Mua hàng: đề xuất → báo giá → so sánh → ngân sách → PO → hợp đồng → ký → nhận hàng → hóa đơn → thanh toán",
    input_hint: "",
    run_group_ids: [],
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: cur.inputs,
    ttl_days: cur.ttl_days,
    stages: purchaseStages().stages,
    trigger: cur.trigger,
    app: cur.app,
    version: cur.version,
  });
  if (put.status >= 300)
    throw new Error(`PUT def ${put.status}: ${JSON.stringify(put.json).slice(0, 400)}`);
  return id;
}

async function publishAndAssign(page: Page, id: string, tenantId: string): Promise<void> {
  await page.goto(`${u.web}/processes/${id}`);
  await page.getByRole("button", { name: /^Xuất bản v/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xuất bản", exact: true }).click();
  await page.getByText("Đã xuất bản").first().waitFor();
  await page.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
  const box = page.getByTestId("company-flows");
  await box.waitFor();
  if (
    (await box
      .locator('li[data-testid^="company-flow-"]')
      .filter({ hasText: FLOW_NAME })
      .count()) === 0
  ) {
    const pick = box.getByRole("combobox").first();
    const v = await pick.locator("option", { hasText: FLOW_NAME }).first().getAttribute("value");
    await pick.selectOption(v as string);
    await box.getByRole("button", { name: "Gán", exact: true }).click();
    await page.waitForTimeout(2000);
  }
}

async function companyCopyAndShots(page: Page, tenantId: string): Promise<void> {
  await login(page, TENANT.key, ADMIN_USER, DEMO_PW);
  await page.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
  const box = page.getByTestId("company-flows");
  await box.waitFor();
  const rows = box.locator('li[data-testid^="company-flow-"]');
  let copy = rows.filter({ hasText: "Sao từ" });
  if ((await copy.count()) === 0) {
    await page.screenshot({ path: `${SHOTS}/00-before-copy.png` });
    console.log((await box.innerText()).replace(/\n+/g, " | ").slice(0, 600));
    await rows
      .filter({ hasText: FLOW_NAME })
      .getByRole("button", { name: "Sao chép để sửa" })
      .click();
    await page.getByTestId("copy-confirm").click();
    copy = rows.filter({ hasText: "Sao từ" });
    await copy.first().waitFor();
  }
  await page.screenshot({ path: `${SHOTS}/01-company-flows.png` });
  await copy.first().getByRole("link", { name: "Mở", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Canvas quy trình" });
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const [dir, file] of [
    ["Ngang", "02-diagram-ngang.png"],
    ["Dọc", "03-diagram-doc.png"],
  ] as const) {
    await page.getByRole("button", { name: dir, exact: true }).click();
    await page.waitForTimeout(1800);
    await page
      .getByRole("button", { name: /Vừa khung|Fit/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);
    await canvas.screenshot({ path: `${SHOTS}/${file}` });
  }
}

async function build(): Promise<string> {
  const { tenantId } = await setupTenant(u);
  const tok = await platformToken(u.api);
  const b = await chromium.launch();
  const fresh = async () =>
    (await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "vi-VN" })).newPage();
  try {
    const page = await fresh();
    await login(
      page,
      "platform",
      process.env.SEED_ADMIN_USERNAME ?? "admin",
      process.env.SEED_ADMIN_PASSWORD ?? "",
    );
    const id = await libraryFlow(page, tok);
    await publishAndAssign(page, id, tenantId);
    await companyCopyAndShots(await fresh(), tenantId);
  } finally {
    await b.close();
  }
  return tenantId;
}

/** Chụp trang lượt chạy (admin-web) của HĐ `cid` sau khi `purchase-flow-run.ts` chạy xong: các bước đã qua / bước kẹt. */
async function runShots(cid: string, name: string): Promise<void> {
  const tok = await (await import("./purchase-flow-setup")).login(
    u.api,
    TENANT.key,
    "quantri",
    DEMO_PW,
  );
  const h = { authorization: `Bearer ${String(tok.access_token)}` };
  const card = (await (
    await fetch(`${u.hub}/pack/contracts/contracts/${cid}/approval`, { headers: h })
  ).json()) as { engine_run_id: string };
  const b = await chromium.launch();
  try {
    const page = await (
      await b.newContext({ viewport: { width: 1600, height: 1100 }, locale: "vi-VN" })
    ).newPage();
    await login(page, TENANT.key, "quantri", DEMO_PW);
    const t = (await (
      await fetch(
        `${u.hub}/process-runs/${card.engine_run_id}/detail?tenant_id=${process.env.TENANT_ID ?? ""}`,
        { headers: h },
      )
    ).json()) as { process?: { id?: string } };
    await page.goto(
      `${u.web}/processes/${process.env.DEF_ID ?? t.process?.id}/runs/${card.engine_run_id}`,
    );
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  } finally {
    await b.close();
  }
}

const mode = process.argv[2] ?? "all";
if (mode === "shots") await runShots(process.argv[3] as string, process.argv[4] ?? "run");
if (mode === "build" || mode === "all") console.log("tenant", await build());
if (mode === "run" || mode === "all")
  console.log(
    "run: chạy `bun --env-file=.env.local tools/demo/purchase-flow-run.ts ok|loop` (hub cần AI giả + FileBox giả + ESIGN_PROVIDERS=selfsign); xem purchase-flow-trial.md",
  );

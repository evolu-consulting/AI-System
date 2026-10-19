// HD-FR-97 · HD9-AC10 · D-02 · plan-frontend N1 §6: so màn S08 `/prices`, S10 `/cks` (+ mở rộng, 2 hộp thoại, mobile), S11
// `/cks/$id` (+ form gia hạn, hộp thoại hoàn tất) với mgmt-app, 3 lớp như `scenes.cw.ts` — chữ (0 ký tự lệch), khung (±2 px),
// ảnh (≤ 0,5 %). `CW_MODE=ref` chụp mgmt-app và GHI baseline; chế độ so đọc baseline, thiếu ⇒ đỏ ngay. Dữ liệu `dataset-cks.ts`.
// Không sleep: chờ phần tử/điều kiện. Harness riêng (không sửa `scenes.cw.ts` của lát khác).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { asHub, asMgmt } from "./dataset";
import { cks, cksAsHub, cksAsMgmt } from "./dataset-cks";

const REF = process.env.CW_MODE === "ref";
const DIR = join(__dirname, "baseline", process.platform);
const HOW =
  "Chụp tham chiếu: `bun run e2e:contracts:ref -- cks.cw.ts` (cần web mgmt-app ở MGMT_WEB_DIR), rồi commit baseline.";
const FRAME_TOL = 2;
const PIXEL_RATIO = 0.005;

type Box = { x: number; y: number; w: number; h: number };
type Layers = { text: string; boxes: Record<string, Box | null> };
type Scene = {
  name: string;
  path: string;
  size: { width: number; height: number };
  theme: "light" | "dark";
  text: string[];
  boxes: Record<string, string>;
  ready: (p: Page) => Locator;
  act?: (p: Page) => Promise<void>;
};

const D = { width: 1440, height: 900 };
const M = { width: 390, height: 844 };
const listBoxes = {
  heading: "main h1",
  stats: "main .grid >> nth=0",
  table: "main table",
  firstRow: "main tbody tr >> nth=0",
};
const custBoxes = {
  heading: "main h1",
  group: "main section >> nth=0",
  docs: "main section >> nth=1",
};
const dlgBoxes = {
  dialog: "dialog[open]",
  form: "dialog[open] form",
  submit: 'dialog[open] button[type="submit"]',
};
const pricesBoxes = {
  heading: "main h1",
  table: "main table",
  firstRow: "main tbody tr >> nth=0",
  panel: "main section >> nth=0",
};
const bv = `/cks/${cks.bepViet.company_id}`;
const listReady = (p: Page) => p.getByRole("link", { name: "Bếp Việt" });
const custReady = (p: Page) => p.getByText("Hóa đơn số 0000012");
const pricesReady = (p: Page) => p.getByText("Viettel-CA · 1 năm");

const SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s10-cks-${theme}`,
      path: "/cks",
      size: D,
      theme,
      text: ["main"],
      boxes: listBoxes,
      ready: listReady,
    }),
  ),
  {
    name: "s10-cks-mobile",
    path: "/cks",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: listBoxes,
    ready: listReady,
  },
  {
    name: "s10-cks-expanded",
    path: "/cks",
    size: D,
    theme: "light",
    text: ["main"],
    boxes: { ...listBoxes, saleRow: "main tbody tr >> nth=2" },
    ready: listReady,
    act: async (p) => {
      await p.getByRole("button", { name: "Mở Bếp Việt" }).click();
      await expect(p.getByText("Giám đốc · Lê Văn Tâm")).toBeVisible();
    },
  },
  {
    name: "s10-lot-dialog",
    path: "/cks",
    size: D,
    theme: "light",
    text: ["dialog[open]"],
    boxes: dlgBoxes,
    ready: listReady,
    act: async (p) => {
      await p.getByRole("button", { name: "+ Nhập lô mua" }).click();
      await expect(p.locator("dialog[open]")).toBeVisible();
    },
  },
  {
    name: "s10-sale-dialog",
    path: "/cks",
    size: D,
    theme: "light",
    text: ["dialog[open]"],
    boxes: dlgBoxes,
    ready: listReady,
    act: async (p) => {
      await p.getByRole("button", { name: "+ Hợp đồng bán chữ ký" }).click();
      await expect(p.locator("dialog[open]")).toBeVisible();
    },
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s11-customer-${theme}`,
      path: bv,
      size: D,
      theme,
      text: ["main"],
      boxes: custBoxes,
      ready: custReady,
    }),
  ),
  {
    name: "s11-renew-ask",
    path: bv,
    size: D,
    theme: "light",
    text: ["main"],
    boxes: { ...custBoxes, form: "main section form" },
    ready: custReady,
    act: async (p) => {
      await p.getByRole("button", { name: "Gia hạn cả nhóm" }).click();
      await expect(p.getByRole("button", { name: "Gia hạn", exact: true })).toBeVisible();
    },
  },
  {
    name: "s11-renewal-dialog",
    path: `/cks/${cks.renewingId}`,
    size: D,
    theme: "light",
    text: ["dialog[open]"],
    boxes: dlgBoxes,
    ready: (p) => p.getByRole("button", { name: "Nhập serial mới" }),
    act: async (p) => {
      await p.getByRole("button", { name: "Nhập serial mới" }).click();
      await expect(p.locator("dialog[open]")).toBeVisible();
    },
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s08-prices-${theme}`,
      path: "/prices",
      size: D,
      theme,
      text: ["main"],
      boxes: pricesBoxes,
      ready: pricesReady,
    }),
  ),
];

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installMgmt(page: Page) {
  const d = asMgmt("editor");
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    (r) => {
      const url = new URL(r.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      const got = cksAsMgmt(path, url.searchParams);
      if (got !== undefined) return json(r, 200, got);
      if (path === "/auth/me") return json(r, 200, d.me);
      if (path === "/auth/options") return json(r, 200, d.options);
      if (path === "/notifications") return json(r, 200, d.notices);
      return r.request().method() === "GET" ? json(r, 200, []) : json(r, 200, {});
    },
  );
}

async function installHub(page: Page) {
  const d = asHub("editor");
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/cks/**", (r) => {
    const url = new URL(r.request().url());
    const got = cksAsHub(url.pathname, url.searchParams);
    return got === undefined
      ? json(r, 404, { error: { code: "NOT_FOUND", message: "x" } })
      : json(r, 200, got);
  });
}

async function prepare(page: Page, s: Scene) {
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+07:00"));
  await page.addInitScript(
    ([theme]) => {
      try {
        localStorage.setItem("ai.locale", "vi");
        localStorage.setItem("assistant:open", "0");
        if (theme === "dark") localStorage.setItem("theme", "dark");
      } catch {
        /* storage bị chặn */
      }
    },
    [s.theme],
  );
  await (REF ? installMgmt(page) : installHub(page));
  await page.setViewportSize(s.size);
  await page.goto(s.path);
  await s.ready(page).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await s.act?.(page);
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

async function collect(page: Page, s: Scene): Promise<Layers> {
  const parts: string[] = [];
  for (const sel of s.text) parts.push(await page.locator(sel).first().innerText());
  const boxes: Layers["boxes"] = {};
  for (const [k, sel] of Object.entries(s.boxes)) {
    const b = await page.locator(sel).first().boundingBox();
    boxes[k] = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  }
  return { text: norm(parts.join(" | ")), boxes };
}

function compare(s: Scene, got: Layers, want: Layers) {
  expect.soft(got.text, `[${s.name}] chữ lệch mgmt-app`).toBe(want.text);
  for (const [k, w] of Object.entries(want.boxes)) {
    const g = got.boxes[k];
    if (!w || !g) {
      expect.soft(g, `[${s.name}] khung "${k}" ${w ? "thiếu" : "thừa"} so với mgmt-app`).toEqual(w);
      continue;
    }
    for (const f of ["x", "y", "w", "h"] as const)
      expect
        .soft(Math.abs(g[f] - w[f]), `[${s.name}] khung "${k}".${f}: hub ${g[f]} · mgmt ${w[f]}`)
        .toBeLessThanOrEqual(FRAME_TOL);
  }
}

// Hành vi (chỉ chế độ so, hub giả): "+ Nhập lô mua" gửi tiền là số nguyên đồng; "+ Hợp đồng bán" hạn tự theo lô và ngày ký;
// lỗi tồn kho hiện câu tiếng Việt theo mã (không thông điệp thô).
test("HD-FR-91 · HD-FR-92 · BR-1 · hộp thoại lô/bán gửi đúng thân, lỗi theo mã", async ({
  page,
}) => {
  test.skip(REF, "chỉ chạy trên contracts-web");
  const sent: { path: string; body: unknown }[] = [];
  await prepare(page, SCENES[0] as Scene);
  await page.route("**/pack/contracts/cks/lots", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    sent.push({ path: "lots", body: r.request().postDataJSON() });
    return json(r, 201, cks.lots[0]);
  });
  await page.route("**/pack/contracts/cks/sales", (r) => {
    sent.push({ path: "sales", body: r.request().postDataJSON() });
    return json(r, 409, { error: { code: "CKS_STOCK", message: "Not enough stock" } });
  });
  await page.getByRole("button", { name: "+ Nhập lô mua" }).click();
  const lot = page.locator("dialog[open]");
  await lot.locator('input[name="ca"]').fill("Viettel-CA");
  await lot.locator('input[name="qty"]').fill("5");
  await lot.locator('input[name="cost"]').fill("1.100.000");
  await lot.getByRole("button", { name: "Nhập lô" }).click();
  await expect(lot).toBeHidden();
  expect(sent[0]).toEqual({
    path: "lots",
    body: {
      ca: "Viettel-CA",
      supplier_name: "Viettel-CA",
      qty: 5,
      unit_cost: 1_100_000,
      years: 1,
      bought_at: "2026-10-18",
      label: null,
      device: "token",
    },
  });
  await page.getByRole("button", { name: "+ Hợp đồng bán chữ ký" }).click();
  const sale = page.locator("dialog[open]");
  await expect(sale.locator('input[name="valid"]')).toHaveValue("2027-10-18");
  await sale.locator('input[name="signed"]').fill("2028-02-29");
  await expect(sale.locator('input[name="valid"]')).toHaveValue("2029-02-28");
  await sale.locator('input[name="company"]').fill("Khách A");
  await sale.locator('input[name="price"]').fill("1.650.000");
  await sale.getByLabel("Tên người giữ").fill("Chữ ký công ty");
  await sale.getByRole("button", { name: "Tạo hợp đồng bán" }).click();
  await expect(sale.getByRole("alert")).toHaveText("Lô không còn đủ chữ ký trong kho");
  expect(sent[1]?.body).toMatchObject({
    company_name: "Khách A",
    price_each: 1_650_000,
    lot_id: cks.lots[0]?.id,
    valid_to: "2029-02-28",
  });
});

for (const s of SCENES) {
  test(`HD-FR-97 · HD9-AC10 · ${s.name} · chữ/khung/ảnh khớp mgmt-app`, async ({ page }) => {
    await prepare(page, s);
    const got = await collect(page, s);
    const file = join(DIR, `${s.name}.json`);
    if (REF) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    } else {
      expect(existsSync(file), `thiếu baseline ${file}. ${HOW}`).toBe(true);
      compare(s, got, JSON.parse(readFileSync(file, "utf8")) as Layers);
    }
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      animations: "disabled",
      caret: "hide",
      threshold: 0.2,
      maxDiffPixelRatio: PIXEL_RATIO,
    });
  });
}

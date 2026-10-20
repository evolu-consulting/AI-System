// HD7-AC09 · HD8-AC08 · plan-frontend N1 §6 · nav-v2 (người dùng chốt 2026-10-20: giao diện theo mockup NITI, thay D-02 "giống hệt mgmt-app"):
// cảnh 3 lớp như `cks.cw.ts` — chữ (0 ký tự lệch), khung (±2 px), ảnh (≤ 0,5 %) so với BASELINE của chính contracts-web: `/partners`
// (+ "Ghi việc", "Chấm điểm", mobile, tối), `/settings/scoring`, `/products?product=` (hàng hoá), khối "Ghi việc với …" của trang HĐ đã
// duyệt. `CW_MODE=capture` chụp từ contracts-web và GHI baseline; chế độ so đọc baseline, thiếu ⇒ đỏ ngay. Hành vi (chỉ chế độ so):
// mỗi nút gửi đúng API/thân. Không sleep: chờ phần tử/điều kiện. Dữ liệu `dataset-partners.ts`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";
import { PORK, partnerData, partnersAsHub } from "./dataset-partners";

const CAPTURE = process.env.CW_MODE === "capture";
const DIR = join(__dirname, "baseline", process.platform);
const HOW =
  "Chụp baseline: `bun run e2e:contracts:capture -- hd78-partners.cw.ts` (hoặc evotest `-Capture cw` cho bản Linux), rồi commit baseline.";
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
  /** Chỉ chụp phần tử này (trang HĐ: phần còn lại thuộc lát khác, có lệch có chủ ý). */
  shot?: string;
};
const D = { width: 1440, height: 900 };
const M = { width: 390, height: 844 };
const LOG = 'section[aria-label="Ghi việc với đối tác"]';
const listBoxes = { panel: "main section >> nth=0", firstRow: "main li >> nth=0" };
const partnersReady = (p: Page) => p.getByText("Kế toán Phương Nam");
const openRow = (what: string) => async (p: Page) => {
  await p.getByRole("button", { name: what }).nth(1).click();
  await expect(
    p
      .locator("main li")
      .nth(1)
      .getByText(what === "Chấm điểm" ? "Thái độ hợp tác" : "giao thiếu 2 suất"),
  ).toBeVisible();
};
const LOG_PANEL = "main section:has(h2:has-text('Ghi việc với'))";

const SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `p02-partners-${theme}`,
      path: "/partners",
      size: D,
      theme,
      text: ["main"],
      boxes: listBoxes,
      ready: partnersReady,
    }),
  ),
  {
    name: "p02-partners-mobile",
    path: "/partners",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: listBoxes,
    ready: partnersReady,
  },
  {
    name: "p02-partners-log",
    path: "/partners",
    size: D,
    theme: "light",
    text: ["main"],
    boxes: { ...listBoxes, log: LOG },
    ready: partnersReady,
    act: openRow("+ Ghi việc"),
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `p06-scoring-${theme}`,
      path: "/settings/scoring",
      size: D,
      theme,
      text: ["main"],
      boxes: {
        heading: "main h1",
        criteria: "main section >> nth=0",
        rules: "main section >> nth=2",
      },
      ready: (p) => p.getByText("Thái độ hợp tác").first(),
    }),
  ),
  {
    name: "p03-goods-light",
    path: `/products?product=${encodeURIComponent(PORK)}`,
    size: D,
    theme: "light",
    text: ["main"],
    boxes: { table: "main table", firstRow: "main tbody tr >> nth=0" },
    ready: (p) => p.getByText("Thực phẩm Hưng Phát"),
  },
  {
    name: "s05-contract-log",
    path: `/contracts/${contract.id}`,
    size: D,
    theme: "light",
    text: [LOG_PANEL],
    boxes: { log: LOG },
    ready: (p) => p.getByRole("button", { name: "+ Ghi việc" }),
    act: async (p) => {
      await p.getByRole("button", { name: "+ Ghi việc" }).click();
      await expect(p.getByText("giao thiếu 2 suất")).toBeVisible();
      // Chỉ chụp khối này; phần trang phía trên khác nhau (lát khác) ⇒ khối nằm ở y lẻ khác nhau ⇒ khử răng cưa chữ lệch. Cả hai phía
      // cùng đẩy khối xuống tới pixel nguyên (≤ 1 px, chỉ trong test) để so ảnh công bằng.
      await p
        .locator(LOG_PANEL)
        .first()
        .evaluate((el: HTMLElement) => {
          const y = el.getBoundingClientRect().top;
          el.style.marginTop = `${Number.parseFloat(getComputedStyle(el).marginTop) + Math.ceil(y) - y}px`;
        });
    },
    shot: LOG_PANEL,
  },
];

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installHub(page: Page) {
  const d = asHub("owner");
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(
    (u) => u.pathname.startsWith("/pack/contracts/"),
    (r) => {
      const url = new URL(r.request().url());
      if (r.request().method() !== "GET") return r.fallback();
      const got = partnersAsHub(url.pathname, url.searchParams);
      if (got !== undefined) return json(r, 200, got);
      if (url.pathname === `/pack/contracts/contracts/${contract.id}`)
        return json(r, 200, contractAsHub("active"));
      if (url.pathname === "/pack/contracts/me") return json(r, 200, d.packMe);
      return json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
    },
  );
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
  await installHub(page);
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
  expect.soft(got.text, `[${s.name}] chữ lệch baseline`).toBe(want.text);
  for (const [k, w] of Object.entries(want.boxes)) {
    const g = got.boxes[k];
    if (!w || !g) {
      expect.soft(g, `[${s.name}] khung "${k}" ${w ? "thiếu" : "thừa"} so với baseline`).toEqual(w);
      continue;
    }
    for (const f of ["x", "y", "w", "h"] as const)
      expect
        .soft(
          Math.abs(g[f] - w[f]),
          `[${s.name}] khung "${k}".${f}: hub ${g[f]} · baseline ${w[f]}`,
        )
        .toBeLessThanOrEqual(FRAME_TOL);
  }
}

for (const s of SCENES) {
  test(`HD7-AC09 · HD8-AC08 · ${s.name} · chữ/khung/ảnh khớp baseline nav-v2`, async ({ page }) => {
    await prepare(page, s);
    const got = await collect(page, s);
    const file = join(DIR, `${s.name}.json`);
    if (CAPTURE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    } else {
      expect(existsSync(file), `thiếu baseline ${file}. ${HOW}`).toBe(true);
      compare(s, got, JSON.parse(readFileSync(file, "utf8")) as Layers);
    }
    const opts = {
      animations: "disabled",
      caret: "hide",
      threshold: 0.2,
      maxDiffPixelRatio: PIXEL_RATIO,
    } as const;
    if (s.shot) await expect(page.locator(s.shot).first()).toHaveScreenshot(`${s.name}.png`, opts);
    else await expect(page).toHaveScreenshot(`${s.name}.png`, opts);
  });
}

// ---------- Hành vi (chỉ contracts-web, hub giả) ----------
type Sent = { method: string; path: string; body: unknown };
async function recordWrites(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route(
    (u) => u.pathname.startsWith("/pack/contracts/") && !u.pathname.endsWith("/me"),
    (r) => {
      const m = r.request().method();
      if (m === "GET") return r.fallback();
      const path = new URL(r.request().url()).pathname.replace("/pack/contracts", "");
      sent.push({ method: m, path, body: r.request().postDataJSON() });
      return json(r, 200, {});
    },
  );
  return sent;
}

test("HD7-FR-04…08 · Ghi việc: Đã thu / Đã nhắc / Khách hẹn lại / việc khác / Huỷ gửi đúng API", async ({
  page,
}) => {
  test.skip(CAPTURE, "chỉ chạy trên contracts-web");
  await prepare(page, SCENES.find((s) => s.name === "p02-partners-log") as Scene);
  const sent = await recordWrites(page);
  const [first] = partnerData.instalments;
  const row = page.locator("main li").nth(1).locator("li").first();
  await row.getByRole("button", { name: "Đã thu" }).click();
  await expect(row.getByText("trễ 8 ngày")).toBeVisible();
  await row.getByRole("button", { name: "Ghi" }).click();
  await row.getByRole("button", { name: "Đã nhắc" }).click();
  await row.getByRole("button", { name: "Khách hẹn lại" }).click();
  await row.getByLabel("Ngày hẹn mới").fill("2026-10-25");
  await row.getByRole("button", { name: "Ghi" }).click();
  const log = page.locator(LOG);
  await log.getByLabel("Loại việc").selectOption("complaint");
  await expect(log.getByRole("button", { name: "Ghi", exact: true }).last()).toBeDisabled();
  await log.getByLabel("Ghi chú").fill("giao thiếu");
  await log.getByRole("button", { name: "Ghi", exact: true }).last().click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent).toEqual([
    { method: "POST", path: `/obligations/${first?.id}/settle`, body: { at: "2026-10-18" } },
    { method: "POST", path: `/obligations/${first?.id}/remind`, body: {} },
    { method: "POST", path: `/obligations/${first?.id}/postpone`, body: { to: "2026-10-25" } },
    {
      method: "POST",
      path: "/partner-events",
      body: {
        party: partnerData.BV,
        role: "customer",
        type: "complaint",
        at: "2026-10-18",
        note: "giao thiếu",
      },
    },
  ]);
  await log.getByRole("button", { name: "Huỷ" }).first().click();
  await page.getByRole("button", { name: "Huỷ việc này" }).click();
  await expect.poll(() => sent.length).toBe(5);
  expect(sent[4]).toEqual({ method: "POST", path: "/partner-events/105/void", body: {} });
});

test("HD8-FR-03 · Cách tính: tổng ≠ 100 khoá nút Lưu; lưu gửi tiêu chí + quy tắc; 422 hiện đúng câu", async ({
  page,
}) => {
  test.skip(CAPTURE, "chỉ chạy trên contracts-web");
  await prepare(page, SCENES.find((s) => s.name === "p06-scoring-light") as Scene);
  const sent: Sent[] = [];
  await page.route("**/pack/contracts/scoring/customer", (r) => {
    if (r.request().method() !== "PUT") return r.fallback();
    sent.push({ method: "PUT", path: "/scoring/customer", body: r.request().postDataJSON() });
    return json(r, 422, {
      error: { code: "SCORING_INVALID", message: "Mức Tốt phải cao hơn mức Khá" },
    });
  });
  const save = page.getByRole("button", { name: "Lưu & tính lại điểm" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Trọng số Giữ lịch hẹn").fill("15");
  await expect(page.getByText("· cần đúng 100%")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("Trọng số Thái độ hợp tác").fill("25");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("alert")).toHaveText("Mức Tốt phải cao hơn mức Khá");
  const body = sent[0]?.body as { criteria: { key: string; weight: number }[]; rules: object };
  expect(body.criteria.map((c) => [c.key, c.weight])).toContainEqual(["appointments", 15]);
  expect(body.criteria.map((c) => [c.key, c.weight])).toContainEqual([
    "custom:thai-do-hop-tac",
    25,
  ]);
  expect(Object.keys(body.rules).sort()).toEqual([
    "fair_from",
    "good_from",
    "manual_adjust",
    "min_events",
    "recency_boost",
    "recency_months",
    "window_months",
  ]);
});

test("HD8-FR-05 · Thêm báo giá gửi đơn giá số nguyên đồng (chấm điểm: V2-I)", async ({ page }) => {
  test.skip(CAPTURE, "chỉ chạy trên contracts-web");
  await prepare(page, SCENES.find((s) => s.name === "p02-partners-light") as Scene);
  const sent = await recordWrites(page);
  await page.goto(`/prices?product=${encodeURIComponent(PORK)}`);
  await page.getByRole("button", { name: "+ Thêm báo giá" }).click();
  const dlg = page.locator("dialog[open]");
  await dlg.locator('input[name="supplier"]').fill("Heo Mới");
  await dlg.locator('input[name="price"]').fill("93.000");
  await dlg.getByRole("button", { name: "Lưu báo giá" }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/prices/quotes",
    body: { product: PORK, supplier_name: "Heo Mới", price: 93_000, quoted_at: "2026-10-18" },
  });
});

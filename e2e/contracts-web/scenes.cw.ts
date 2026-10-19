// PK-FR-10 · D-02 · N1 plan-frontend §6 (TF7): so màn hình contracts-web với mgmt-app, 3 lớp — chữ (innerText chuẩn hoá, lệch 0
// ký tự) · khung (bounding box ±2 px) · ảnh (toHaveScreenshot, ≤ 0,5 %). Baseline theo OS ở `baseline/<platform>/`: S01 đăng nhập,
// Shell, S16 chuông. Chế độ `CW_MODE=ref` chụp từ web mgmt-app và GHI baseline; chế độ so đọc baseline — thiếu ⇒ đỏ ngay.
// Lệch có chủ ý (D-21: ô "Mã công ty") ghi ở `DEVIATIONS.md` và bị ẩn đúng chỗ ở `HIDE`. Không sleep: chờ phần tử/điều kiện.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { asHub, asMgmt } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub, contractAsMgmt } from "./dataset-contract";

const REF = process.env.CW_MODE === "ref";
const DIR = join(__dirname, "baseline", process.platform);
const HOW =
  "Chụp tham chiếu: `bun run e2e:contracts:ref` (cần web mgmt-app ở MGMT_WEB_DIR, mặc định F:\\workspace\\mgmt-app\\web), rồi commit baseline.";
const FRAME_TOL = 2;
const PIXEL_RATIO = 0.005;
/** Lệch có chủ ý — ẩn ở cả hai phía để phần còn lại vẫn so được (xem DEVIATIONS.md). */
const HIDE =
  "label:has(input[name=tenant_key]){display:none !important}" +
  // HD3: "Xác nhận" của S05 đã có (so thật); nút/khối duyệt không có ở mgmt-app ("Duyệt", "Từ chối", "Đọc lại", ghi chú) ẩn.
  "[data-approval]{display:none !important}" +
  // HD5: khối "Phụ lục và giá" của S05 không có trong mgmt-app web (phụ lục do backend tự gắn) — ẩn ở cả hai phía.
  "[data-hd5]{display:none !important}";

type Box = { x: number; y: number; w: number; h: number };
type Layers = { text: string; boxes: Record<string, Box | null> };
type Scene = {
  name: string;
  signedIn: boolean;
  path: string;
  size: { width: number; height: number };
  theme: "light" | "dark";
  /** Vùng lấy chữ (CSS), ghép theo thứ tự. */
  text: string[];
  boxes: Record<string, string>;
  mask: string[];
  ready: (page: Page) => Locator;
  act?: (page: Page) => Promise<void>;
};

const D = { width: 1440, height: 900 };
const M = { width: 390, height: 844 };
const NAV = 'nav[aria-label="Điều hướng chính"]';
const shellBoxes = {
  sidebar: NAV,
  header: "header",
  bell: 'header button[aria-label^="Thông báo"]',
  feedback: 'header button[aria-label="Góp ý về app"]',
  assistantFab: 'button[aria-label="Mở trợ lý AI"]',
  firstNavLink: `${NAV} a >> nth=1`,
};
const mobileBoxes = {
  header: "header",
  bottomNav: 'nav[aria-label="Điều hướng"]',
  assistantFab: 'button[aria-label="Mở trợ lý AI"]',
};
const loginBoxes = {
  heading: 'h1:text-is("Đăng nhập")',
  form: "form",
  submit: 'form button[type="submit"]',
  password: 'input[name="password"]',
};

// ---------- HD2: S04 nhập tay, S05 kiểm/sửa (dữ liệu `dataset-contract.ts`) ----------
const FAILED_ID = contract.id.replace(/1$/, "2");
const reviewBoxes = {
  heading: "main h1",
  save: 'main button:text-is("Lưu")',
  file: 'main a:has-text("Xem file gốc")',
  warnings: "main ul",
  firstField: "main input >> nth=0",
  quote: "main label span.italic >> nth=0",
  items: "main table",
};
const newBoxes = {
  heading: "main h1",
  form: "main form",
  title: 'main input[name="title"]',
  items: "main fieldset",
  submit: 'main button[type="submit"]',
};
const mainReady = (p: Page) => p.locator("main h1");
const HD2_SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s05-review-${theme}`,
      signedIn: true,
      path: `/contracts/${contract.id}`,
      size: D,
      theme,
      text: ["main"],
      boxes: reviewBoxes,
      mask: [],
      ready: (p) => p.locator("main table"),
    }),
  ),
  {
    name: "s05-review-mobile",
    signedIn: true,
    path: `/contracts/${contract.id}`,
    size: M,
    theme: "light",
    text: ["main"],
    boxes: reviewBoxes,
    mask: [],
    ready: (p) => p.locator("main table"),
  },
  {
    name: "s05-failed-light",
    signedIn: true,
    path: `/contracts/${FAILED_ID}`,
    size: D,
    theme: "light",
    text: ["main"],
    boxes: {
      heading: "main h1",
      manual: 'main a:text-is("Nhập tay")',
      panel: "main section >> nth=0",
    },
    mask: [],
    ready: (p) => p.getByText("Không đọc được hợp đồng này."),
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s04-new-${theme}`,
      signedIn: true,
      path: "/contracts/new",
      size: D,
      theme,
      text: ["main"],
      boxes: newBoxes,
      mask: [],
      ready: mainReady,
    }),
  ),
  {
    name: "s04-new-mobile",
    signedIn: true,
    path: "/contracts/new",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: newBoxes,
    mask: [],
    ready: mainReady,
  },
];

// ---------- HD5: S03 danh sách hợp đồng (dữ liệu `dataset-list.ts`) ----------
const listBoxes = {
  heading: "main h1",
  search: "main input[type=search]",
  table: "main table",
  firstRow: "main tbody tr >> nth=0",
  pager: "main nav",
};
const listReady = (p: Page) => p.locator("main").getByText("Hợp đồng mua bán bao bì 2026").first();
const HD5_SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s03-list-${theme}`,
      signedIn: true,
      path: "/contracts",
      size: D,
      theme,
      text: ["main"],
      boxes: listBoxes,
      mask: [],
      ready: listReady,
    }),
  ),
  {
    name: "s03-list-mobile",
    signedIn: true,
    path: "/contracts",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: { search: listBoxes.search, firstCard: "main ul li >> nth=0", pager: listBoxes.pager },
    mask: [],
    ready: (p) => p.locator("main ul li").first(),
  },
];

const SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s01-login-${theme}`,
      signedIn: false,
      path: "/login",
      size: D,
      theme,
      text: ["body"],
      boxes: loginBoxes,
      mask: [],
      ready: (p) => p.getByRole("heading", { name: "Đăng nhập" }),
    }),
  ),
  {
    name: "s01-login-mobile",
    signedIn: false,
    path: "/login",
    size: M,
    theme: "light",
    text: ["body"],
    boxes: loginBoxes,
    mask: [],
    ready: (p) => p.getByRole("heading", { name: "Đăng nhập" }),
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `shell-${theme}`,
      signedIn: true,
      path: "/contracts",
      size: D,
      theme,
      text: [NAV, "header"],
      boxes: shellBoxes,
      mask: ["main"],
      ready: (p) => p.locator(NAV),
    }),
  ),
  {
    name: "shell-sidebar-open",
    signedIn: true,
    path: "/contracts",
    size: D,
    theme: "light",
    text: [NAV, "header"],
    boxes: shellBoxes,
    mask: ["main"],
    ready: (p) => p.locator(NAV),
    act: async (p) => {
      await p.locator(NAV).hover();
      await expect.poll(async () => (await p.locator(NAV).boundingBox())?.width).toBe(224);
    },
  },
  {
    name: "shell-mobile",
    signedIn: true,
    path: "/contracts",
    size: M,
    theme: "light",
    text: ["header", 'nav[aria-label="Điều hướng"]'],
    boxes: mobileBoxes,
    mask: ["main"],
    ready: (p) => p.locator('nav[aria-label="Điều hướng"]'),
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `s16-bell-${theme}`,
      signedIn: true,
      path: "/contracts",
      size: D,
      theme,
      text: ["header"],
      boxes: { ...shellBoxes, popover: 'header button[aria-label^="Thông báo"] + div' },
      mask: ["main"],
      ready: (p) => p.locator(NAV),
      act: async (p) => {
        await p.locator('header button[aria-label^="Thông báo"]').click();
        await expect(p.getByText("Chưa có thông báo nào.")).toBeVisible();
      },
    }),
  ),
  ...HD2_SCENES,
  ...HD5_SCENES,
];

/** mgmt-app: API `/api/**` giả bằng dữ liệu chung (asMgmt). */
async function installMgmt(page: Page, signedIn: boolean) {
  const d = asMgmt("editor");
  // Chỉ `/api/…` của origin (không chặn module nguồn `/src/api/*.ts` của Vite).
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      const json = (status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/auth/me")
        return signedIn ? json(200, d.me) : json(401, { detail: "Chưa đăng nhập" });
      if (path === "/auth/options") return json(200, d.options);
      if (path === `/contracts/${contract.id}`) return json(200, contractAsMgmt());
      if (path === `/contracts/${FAILED_ID}`)
        return json(200, {
          ...contractAsMgmt("extract_failed"),
          id: FAILED_ID,
          items: [],
          warnings: [],
        });
      return json(
        200,
        mgmtListGet(path, d.notices) ?? (route.request().method() === "GET" ? [] : {}),
      );
    },
  );
}

/** contracts-web: `/auth/refresh` + `/pack/contracts/me` giả bằng dữ liệu chung (asHub). */
async function installHub(page: Page, signedIn: boolean) {
  const d = asHub("editor");
  const json = (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    status: number,
    body: unknown,
  ) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/auth/refresh", (r) =>
    signedIn
      ? json(r, 200, d.grant)
      : json(r, 401, { error: { code: "UNAUTHORIZED", message: "Hết phiên" } }),
  );
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  const at = (name: string) => (u: URL) => u.pathname === `/pack/contracts/${name}`;
  await page.route(at("contracts"), (r) => json(r, 200, listAsHub()));
  await page.route(at("contracts/facets"), (r) => json(r, 200, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, 200, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, 200, membersAsHub()));
  await page.route(`**/pack/contracts/contracts/${contract.id}`, (r) =>
    json(r, 200, contractAsHub()),
  );
  // HD3: HĐ cần kiểm ở bước duyệt cấp 1, người xem quyết được ⇒ "Xác nhận" như mgmt-app; HĐ đọc lỗi chưa có run.
  await page.route(`**/pack/contracts/contracts/${contract.id}/approval`, (r) =>
    json(r, 200, approvalAsHub("level1")),
  );
  await page.route(`**/pack/contracts/contracts/${FAILED_ID}/approval`, (r) =>
    json(r, 200, approvalAsHub(null)),
  );
  await page.route(`**/pack/contracts/contracts/${FAILED_ID}`, (r) =>
    json(r, 200, { ...contractAsHub("extract_failed"), id: FAILED_ID, items: [], warnings: [] }),
  );
}

async function prepare(page: Page, s: Scene) {
  // Cố định nhiễu (plan §6.4): giờ, ngôn ngữ, giao diện, panel trợ lý đóng (nội dung panel khác nhau theo thiết kế).
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
  await (REF ? installMgmt(page, s.signedIn) : installHub(page, s.signedIn));
  await page.setViewportSize(s.size);
  await page.goto(s.path);
  await page.addStyleTag({ content: HIDE });
  await s.ready(page).waitFor();
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

for (const s of SCENES) {
  test(`PK-FR-10 · D-02 · ${s.name} · chữ/khung/ảnh khớp mgmt-app`, async ({ page }) => {
    await prepare(page, s);
    const got = await collect(page, s);
    const file = join(DIR, `${s.name}.json`);
    if (REF) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    } else {
      expect(existsSync(file), `thiếu baseline ${file}. ${HOW}`).toBe(true);
      const want = JSON.parse(readFileSync(file, "utf8")) as Layers;
      // Lớp 1 — chữ: 0 ký tự lệch.
      expect.soft(got.text, `[${s.name}] chữ lệch mgmt-app`).toBe(want.text);
      // Lớp 2 — khung: ±2 px mỗi cạnh/kích thước.
      for (const [k, w] of Object.entries(want.boxes)) {
        const g = got.boxes[k];
        if (!w || !g) {
          expect
            .soft(g, `[${s.name}] khung "${k}" ${w ? "thiếu" : "thừa"} so với mgmt-app`)
            .toEqual(w);
          continue;
        }
        for (const f of ["x", "y", "w", "h"] as const) {
          expect
            .soft(
              Math.abs(g[f] - w[f]),
              `[${s.name}] khung "${k}".${f}: hub ${g[f]} · mgmt ${w[f]}`,
            )
            .toBeLessThanOrEqual(FRAME_TOL);
        }
      }
    }
    // Lớp 3 — ảnh: chế độ ref ghi baseline (updateSnapshots all), chế độ so ≤ 0,5 % điểm lệch.
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      animations: "disabled",
      caret: "hide",
      mask: s.mask.map((m) => page.locator(m)),
      threshold: 0.2,
      maxDiffPixelRatio: PIXEL_RATIO,
    });
  });
}

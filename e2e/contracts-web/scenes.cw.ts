// PK-FR-10 · nav-v2 (người dùng chốt 2026-10-20: cấu trúc trang + giao diện theo mockup NITI, thay D-02 "giống hệt mgmt-app"): cảnh màn hình
// contracts-web, 3 lớp — chữ (innerText chuẩn hoá, lệch 0 ký tự) · khung (bounding box ±2 px) · ảnh (toHaveScreenshot, ≤ 0,5 %) — so với
// BASELINE của chính contracts-web ở `baseline/<platform>/`: S01 đăng nhập, Shell (sidebar mở/thu, mobile), S16 chuông, Tổng quan, S03/S04/S05.
// `CW_MODE=capture` chụp từ contracts-web và GHI baseline (`bun run e2e:contracts:capture`; bản Linux: evotest `-Capture cw`); chế độ so đọc
// baseline — thiếu ⇒ đỏ ngay. Không sleep: chờ phần tử/điều kiện.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";
import { categoriesAsHub, facetsAsHub, membersAsHub } from "./dataset-list";
import {
  bizListAsHub,
  contractsListAsHub,
  overviewAsHub,
  partnersForOverview,
  todoAsHub,
} from "./dataset-overview";
import { ACTIVE_ID, activeContract, lookupFor, matchFor, PRODUCTS } from "./dataset-v2f";

const CAPTURE = process.env.CW_MODE === "capture";
const DIR = join(__dirname, "baseline", process.platform);
const HOW =
  "Chụp baseline: `bun run e2e:contracts:capture` (hoặc evotest `-Capture cw` cho bản Linux), rồi commit baseline.";
const FRAME_TOL = 2;
const PIXEL_RATIO = 0.005;
/** Khối "Phụ lục và giá" của S05 gọi API phụ lục không giả ở đây ⇒ ẩn để cảnh không phụ thuộc thời điểm tải. */
const HIDE = "[data-hd5]{display:none !important}";
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
  file: 'main a:has-text("Xem hợp đồng gốc")',
  warnings: "main ul",
  firstField: "main input >> nth=0",
  quote: "main span.italic >> nth=0",
  items: "main table",
};
const newBoxes = {
  heading: "main h1",
  form: "main form",
  title: 'main input[name="title"]',
  items: "main table",
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

// ---------- V2-F: chi tiết HĐ đã có hiệu lực (dòng thời gian mốc) + form nhập tay đã chọn loại Bán, có dòng hàng gắn SP ----------
const detailBoxes = {
  heading: "main h1",
  info: "main section >> nth=0",
  timeline: 'main section:has-text("Dòng thời gian") >> nth=0',
  currentStep: 'main li[data-state="cur"]',
  confirm: 'main li[data-state="cur"] button:has-text("Xác nhận xong")',
  summary: 'main [data-testid="summary"]',
};
const V2F_SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `v2f-detail-${theme}`,
      signedIn: true,
      path: `/contracts/${ACTIVE_ID}`,
      size: D,
      theme,
      text: ["main"],
      boxes: detailBoxes,
      mask: [],
      ready: (p) => p.getByTestId("stage-now"),
    }),
  ),
  {
    name: "v2f-detail-mobile",
    signedIn: true,
    path: `/contracts/${ACTIVE_ID}`,
    size: M,
    theme: "light",
    text: ["main"],
    boxes: { heading: detailBoxes.heading, timeline: detailBoxes.timeline },
    mask: [],
    ready: (p) => p.getByTestId("stage-now"),
  },
  {
    name: "v2f-detail-confirm-box",
    signedIn: true,
    path: `/contracts/${ACTIVE_ID}`,
    size: D,
    theme: "light",
    text: ["main"],
    boxes: {
      heading: detailBoxes.heading,
      timeline: detailBoxes.timeline,
      box: 'main [data-testid="confirm-box"]',
    },
    mask: [],
    ready: (p) => p.getByTestId("stage-now"),
    act: async (p) => {
      await p.getByRole("button", { name: "Xác nhận xong" }).click();
      await expect(p.getByText("Mốc trễ 8 ngày — lỗi của ai?")).toBeVisible();
    },
  },
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `v2f-new-sell-${theme}`,
      signedIn: true,
      path: "/contracts/new",
      size: D,
      theme,
      text: ["main"],
      boxes: {
        ...newBoxes,
        bar: 'main [data-testid="form-bar"]',
        tiles: 'main [role="radiogroup"] >> nth=0',
        link: 'main [data-testid="link-0"]',
      },
      mask: [],
      ready: mainReady,
      act: async (p) => {
        await p.getByRole("radio", { name: /^Bán/ }).click();
        await p.getByLabel(/^Khách hàng/).fill("Công ty Hoàn Toàn Mới");
        await expect(p.getByText("Đối tác mới · sẽ tạo khi lưu")).toBeVisible();
        await p.getByLabel("Tên hàng").fill("USB Token trắng");
        await p.getByLabel("Số lượng", { exact: true }).fill("50");
        await p.getByLabel("Tên hàng").blur();
        await expect(p.getByTestId("oversell")).toBeVisible();
      },
    }),
  ),
  {
    name: "v2f-new-sell-mobile",
    signedIn: true,
    path: "/contracts/new",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: {
      heading: "main h1",
      bar: 'main [data-testid="form-bar"]',
      tiles: 'main [role="radiogroup"] >> nth=0',
    },
    mask: [],
    ready: mainReady,
  },
];

// ---------- nav-v2: Tổng quan `/overview` (dữ liệu `dataset-overview.ts`) ----------
const overviewBoxes = {
  heading: "main h1",
  work: "main section >> nth=0",
  firstWorkRow: 'main [data-testid="todo-row"] >> nth=0',
  contracts: "main section >> nth=1",
  partners: "main section >> nth=2",
};
const overviewReady = (p: Page) => p.getByTestId("review-partners");
const OVERVIEW_SCENES: Scene[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scene => ({
      name: `overview-${theme}`,
      signedIn: true,
      path: "/overview",
      size: D,
      theme,
      text: ["main"],
      boxes: overviewBoxes,
      mask: [],
      ready: overviewReady,
    }),
  ),
  {
    name: "overview-mobile",
    signedIn: true,
    path: "/overview",
    size: M,
    theme: "light",
    text: ["main"],
    boxes: { heading: overviewBoxes.heading, work: overviewBoxes.work },
    mask: [],
    ready: overviewReady,
  },
  {
    name: "overview-work-expanded",
    signedIn: true,
    path: "/overview",
    size: D,
    theme: "light",
    text: ["main"],
    boxes: overviewBoxes,
    mask: [],
    ready: overviewReady,
    act: async (p) => {
      await p.getByRole("button", { name: "Xem thêm 2 việc" }).click();
      await expect(p.getByTestId("todo-row")).toHaveCount(8);
    },
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
    // nav-v2: sidebar ghim mở 224 px là mặc định (cảnh `shell-*`); nút ở thanh trên thu về cột biểu tượng 64 px.
    name: "shell-sidebar-collapsed",
    signedIn: true,
    path: "/contracts",
    size: D,
    theme: "light",
    text: [NAV, "header"],
    boxes: shellBoxes,
    mask: ["main"],
    ready: (p) => p.locator(NAV),
    act: async (p) => {
      await p.getByRole("button", { name: "Thu gọn thanh bên" }).click();
      await expect.poll(async () => (await p.locator(NAV).boundingBox())?.width).toBe(64);
    },
  },
  {
    // nav-v2: menu avatar ở chân sidebar (Cài đặt · Đăng xuất · Giao diện).
    name: "shell-account-menu",
    signedIn: true,
    path: "/contracts",
    size: D,
    theme: "light",
    text: [NAV, "header"],
    boxes: { ...shellBoxes, menu: 'nav[aria-label="Điều hướng chính"] [role="menu"]' },
    mask: [], // menu nổi lên trên vùng nội dung ⇒ không che `main` (danh sách HĐ giả, ổn định)
    ready: (p) => p.locator(NAV),
    act: async (p) => {
      await p.locator(NAV).getByRole("button", { name: "Tài khoản" }).click();
      await expect(p.getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible();
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
  ...OVERVIEW_SCENES,
  ...HD2_SCENES,
  ...HD5_SCENES,
  ...V2F_SCENES,
];

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
  await page.route(at("contracts"), (r) =>
    json(r, 200, contractsListAsHub(new URL(r.request().url()).searchParams)),
  );
  await page.route(at("my-work/todo"), (r) => json(r, 200, todoAsHub()));
  await page.route(at("overview"), (r) =>
    json(r, 200, overviewAsHub(new URL(r.request().url()).searchParams.get("period") ?? "month")),
  );
  await page.route(at("business/products"), (r) => json(r, 200, bizListAsHub()));
  await page.route(at("partners"), (r) =>
    json(r, 200, partnersForOverview(new URL(r.request().url()).searchParams)),
  );
  await page.route(at("contracts/facets"), (r) => json(r, 200, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, 200, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, 200, membersAsHub()));
  // V2-F: danh mục SP + gợi ý đối tác (form nhập tay) và HĐ đã có hiệu lực (dòng thời gian).
  await page.route(at("products"), (r) => json(r, 200, { items: PRODUCTS }));
  await page.route(at("products/match"), (r) =>
    json(r, 200, matchFor((r.request().postDataJSON() as { text: string }).text)),
  );
  await page.route(at("partners/lookup"), (r) =>
    json(r, 200, lookupFor(new URL(r.request().url()).searchParams.get("name") ?? "")),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}`, (r) =>
    json(r, 200, activeContract()),
  );
  await page.route(`**/pack/contracts/contracts/${contract.id}`, (r) =>
    json(r, 200, contractAsHub()),
  );
  // HD3: HĐ cần kiểm ở bước duyệt cấp 1, người xem quyết được ⇒ "Xác nhận"; HĐ đọc lỗi chưa có run.
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
  await installHub(page, s.signedIn);
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
  test(`PK-FR-10 · nav-v2 · ${s.name} · chữ/khung/ảnh khớp baseline`, async ({ page }) => {
    await prepare(page, s);
    const got = await collect(page, s);
    const file = join(DIR, `${s.name}.json`);
    if (CAPTURE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    } else {
      expect(existsSync(file), `thiếu baseline ${file}. ${HOW}`).toBe(true);
      const want = JSON.parse(readFileSync(file, "utf8")) as Layers;
      // Lớp 1 — chữ: 0 ký tự lệch.
      expect.soft(got.text, `[${s.name}] chữ lệch baseline`).toBe(want.text);
      // Lớp 2 — khung: ±2 px mỗi cạnh/kích thước.
      for (const [k, w] of Object.entries(want.boxes)) {
        const g = got.boxes[k];
        if (!w || !g) {
          expect
            .soft(g, `[${s.name}] khung "${k}" ${w ? "thiếu" : "thừa"} so với baseline`)
            .toEqual(w);
          continue;
        }
        for (const f of ["x", "y", "w", "h"] as const) {
          expect
            .soft(
              Math.abs(g[f] - w[f]),
              `[${s.name}] khung "${k}".${f}: hub ${g[f]} · baseline ${w[f]}`,
            )
            .toBeLessThanOrEqual(FRAME_TOL);
        }
      }
    }
    // Lớp 3 — ảnh: chế độ capture ghi baseline (updateSnapshots all), chế độ so ≤ 0,5 % điểm lệch.
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      animations: "disabled",
      caret: "hide",
      mask: s.mask.map((m) => page.locator(m)),
      threshold: 0.2,
      maxDiffPixelRatio: PIXEL_RATIO,
    });
  });
}

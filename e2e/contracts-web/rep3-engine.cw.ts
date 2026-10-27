// REP-v3-ui · R55–R57 · R68 · R71 · R74 · UI uy tín theo engine (`GET /reputation/config` → `engine`), backend giả `page.route`, không sleep.
//  - hd8 (mặc định, cờ tắt): Đối tác đọc `/partners`, Cài đặt = cách tính HD8 theo vai, Tổng quan "Đối tác cần xem lại"; quản lý thấy màn xem trước.
//  - v2e (BA v2.0 §5.1): Đối tác đọc `/reputation/partners` (vai × nhóm SP, mức 85/70, cờ đỏ giữ), chi tiết có bảng Góp + các bước + biểu đồ 3/6/12
//    tháng + sao; Cài đặt = 5 ô × 3 tab, không còn chỉnh tay ±10 / cấu hình HD8; Tổng quan "Cần chú ý" (TQ-04).
// Chạy riêng: `bun tools/scripts/src/run-playwright.ts e2e/contracts-web/playwright.config.ts rep3-engine.cw.ts`.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { facetsAsHub } from "./dataset-list";
import {
  bizListAsHub,
  contractsListAsHub,
  overviewAsHub,
  partnersForOverview,
  todoAsHub,
} from "./dataset-overview";

test.skip(process.env.CW_MODE === "capture", "chỉ kiểm hành vi contracts-web");

type Engine = "hd8" | "v2e";
const A = "tax:0301000001";
const B = "tax:0302000002";
const NOW = "2026-10-27";
const SETTINGS = {
  good_from: 85,
  fair_from: 70,
  min_jobs: 3,
  manual_share: 20,
  reason_gap: 25,
  lock_period: "month",
};
const crit = (key: string, label: string, kind: string, weight: number) => ({
  key,
  label,
  kind,
  weight,
  enabled: true,
  custom: false,
  ...(kind === "ontime" ? { milestone: "delivery" } : {}),
});
const CELL = {
  criteria: [
    crit("on_time_delivery", "Giao đúng hạn", "ontime", 60),
    crit("quality", "Chất lượng", "manual", 40),
  ],
  window_months: 12,
  decay: { months: [12, 24], factors: [1, 0.5, 0.2] },
  late_per_day: 2,
};
const CELLS = Object.fromEntries(
  [
    "service:supplier",
    "service:customer",
    "goods:supplier",
    "goods:customer",
    "referral:commission_payer",
  ].map((k) => [k, CELL]),
);
const CONFIG = (engine: Engine) => ({
  engine,
  cells: CELLS,
  settings: SETTINGS,
  job_types: [],
  versions: {},
  defaults: { cells: CELLS, settings: SETTINGS, job_types: [] },
});

// ---------- hd8 ----------
const HD8_ROW = {
  party: A,
  name: "NCC Minh An",
  role: "supplier",
  roles: ["supplier"],
  score: 74,
  band: "fair",
  reason: "Đúng hạn 5/6 đợt",
  event_count: 6,
  adjust: 0,
  contracts: 3,
};
// ---------- v2e ----------
const group = (g: string, score: number | null, level: string) => ({
  group: g,
  score,
  data_score: score,
  stars: null,
  level,
  jobs: 6,
  value: 100,
});
const REP_ROWS = [
  {
    party: A,
    name: "NCC Minh An",
    role: "supplier",
    score: 91,
    level: "good",
    jobs: 6,
    groups: [group("service", 91, "good")],
    red_flag: true,
    red_flags: [{ type: "fraud", n: 1 }],
  },
  {
    party: A,
    name: "NCC Minh An",
    role: "commission_payer",
    score: 62,
    level: "watch",
    jobs: 4,
    groups: [group("referral", 62, "watch")],
  },
  {
    party: B,
    name: "Công ty Mới Tinh",
    role: "customer",
    score: 55,
    level: "new",
    jobs: 1,
    groups: [],
  },
];
const DETAIL = {
  party: A,
  name: "NCC Minh An",
  role: "supplier",
  score: 91,
  level: "good",
  jobs: 6,
  groups: [
    {
      ...group("service", 91, "good"),
      role: "supplier",
      criteria: [
        {
          key: "on_time_delivery",
          label: "Giao đúng hạn",
          kind: "ontime",
          weight: 60,
          score: 95,
          n: 5,
        },
        { key: "quality", label: "Chất lượng", kind: "manual", weight: 40, score: null, n: 0 },
      ],
    },
  ],
  items: [],
};
const history = (months: number) => ({
  party: A,
  role: "supplier",
  months,
  thresholds: { good_from: 85, fair_from: 70 },
  points: [
    { period: "2026-08", score: 78, level: "fair", jobs: 5 },
    { period: "2026-09", score: 84, level: "fair", jobs: 6 },
  ],
  current: { period: "2026-10", score: 91, level: "good", jobs: 6 },
});
const ATTENTION = [
  { ...REP_ROWS[0], reasons: ["red_flag"], before: null, drop: null },
  { ...REP_ROWS[1], reasons: ["watch", "drop"], before: 70, drop: 8 },
];
const SWITCH = {
  engine: "hd8",
  total: 5,
  changed: 3,
  partners: 2,
  moves: [
    { from: "fair", to: "good", n: 2 },
    { from: "good", to: "watch", n: 1 },
  ],
  items: [],
};
const CO = {
  name: "NITI GROUP",
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "light",
  own_names: [],
  own_tax_ids: [],
};
const BIZ = {
  w: { rot: 40, margin: 35, trend: 25 },
  buyDays: 45,
  dumpDays: 150,
  quotaBuy: 120,
  quotaDump: 70,
  hi: 70,
  lo: 45,
  vol: 6,
  soon: 60,
};

type Sent = { method: string; path: string; body: unknown };
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function install(page: Page, engine: Engine, role: Role = "owner", overviewRows = false) {
  const d = asHub(role);
  const sent: Sent[] = [];
  const asked: string[] = [];
  await page.clock.setFixedTime(new Date(`${NOW}T09:00:00+07:00`));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route(
    (u) => u.pathname.startsWith("/pack/contracts/"),
    (r) => {
      const url = new URL(r.request().url());
      const p = url.pathname.replace("/pack/contracts", "");
      const m = r.request().method();
      const q = url.searchParams;
      if (m !== "GET") {
        let body: unknown = null;
        try {
          body = r.request().postDataJSON();
        } catch {
          body = null;
        }
        sent.push({ method: m, path: p, body });
        if (p === "/reputation/config/preview") return json(r, 200, { total: 3, changes: [] });
        return json(r, 200, {});
      }
      asked.push(p);
      const table = tableOf(engine, d.packMe, q, overviewRows);
      return p in table
        ? json(r, 200, table[p])
        : json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
    },
  );
  return { sent, asked };
}

function tableOf(
  engine: Engine,
  packMe: unknown,
  q: URLSearchParams,
  overviewRows: boolean,
): Record<string, unknown> {
  return {
    "/me": packMe,
    "/reputation/config": CONFIG(engine),
    "/reputation/partners": REP_ROWS,
    "/reputation/partner": DETAIL,
    "/reputation/history": history(Number(q.get("months") ?? 12)),
    "/reputation/ratings": { current: [], history: [] },
    "/reputation/attention": ATTENTION,
    "/reputation/switch-preview": { ...SWITCH, engine },
    "/reputation/mine": {
      days: 90,
      total: 0,
      late: 0,
      on_time_pct: 100,
      by_fault: { ours: 0, partner: 0, unknown: 0 },
      by_deal: [],
      blamed: [],
    },
    "/partners": overviewRows
      ? partnersForOverview(q)
      : q.get("role") === "supplier"
        ? [HD8_ROW]
        : [],
    "/partners/contract-counts": [{ party: A, n: 3 }],
    "/partners/profile": {
      party: A,
      name: "NCC Minh An",
      tax_id: "0301000001",
      phone: null,
      contact: "Nguyễn Văn A",
    },
    "/partners/roles": [
      {
        party: A,
        role: "supplier",
        name: "NCC Minh An",
        events: 6,
        min_events: 3,
        is_new: false,
      },
    ],
    "/partners/notes": [],
    "/partner-events": [],
    "/company": {
      company: CO,
      approval_enabled: true,
      defaults: { ...CO, name: null, theme: "auto", approval_enabled: true },
      version: 0,
      updated_at: null,
    },
    "/business/config": { config: BIZ, defaults: BIZ, version: 0, updated_at: null },
    "/scoring/customer": hd8Scoring("customer"),
    "/scoring/supplier": hd8Scoring("supplier"),
    "/scoring/customer/history": [],
    "/scoring/supplier/history": [],
    "/my-work/todo": todoAsHub(),
    "/overview": overviewAsHub(q.get("period") ?? "month"),
    "/business/products": bizListAsHub(),
    "/contracts/facets": facetsAsHub(),
    "/contracts": contractsListAsHub(q),
  };
}

function hd8Scoring(role: string) {
  return {
    role,
    version: 4,
    criteria: [
      { key: "on_time", label: "Đúng hạn", kind: "auto", enabled: true, weight: 60 },
      { key: "reminders", label: "Ít phải nhắc", kind: "auto", enabled: true, weight: 40 },
    ],
    rules: {
      good_from: 80,
      fair_from: 60,
      min_events: 3,
      window_months: 12,
      recency_boost: true,
      recency_months: 3,
      manual_adjust: true,
    },
    updated_by: "Lan",
    updated_at: "2026-10-01T02:00:00Z",
    restorable: [],
    manual_choices: [],
  };
}

const openSettings = async (page: Page) => {
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  return dlg;
};

// ---------------------------------------------------------------- Đối tác
test("hd8 · danh sách đọc /partners: không gọi /reputation/partners, không có bộ lọc Bên trả hoa hồng", async ({
  page,
}) => {
  const { asked } = await install(page, "hd8");
  await page.goto("/partners");
  await expect(page.getByTestId("partner-list")).toContainText("KHÁ");
  await expect(page.getByRole("button", { name: "Bên trả hoa hồng" })).toHaveCount(0);
  expect(asked.includes("/reputation/partners")).toBe(false);
});

test("v2e · danh sách đọc /reputation/partners: mức theo ngưỡng, MỚI · tạm tính, cờ đỏ giữ, thêm vai Bên trả hoa hồng", async ({
  page,
}) => {
  const { asked } = await install(page, "v2e");
  await page.goto("/partners");
  const list = page.getByTestId("partner-list");
  const flagged = list.getByRole("listitem").filter({ hasText: "NCC Minh An" });
  await expect(flagged.getByTestId("red-flag")).toContainText("Gian lận");
  await expect(flagged).toContainText("91");
  await expect(flagged).toContainText("CHÚ Ý"); // vai bên trả hoa hồng 62 < 70
  await expect(list.getByRole("listitem").filter({ hasText: "Công ty Mới Tinh" })).toContainText(
    "MỚI · tạm tính",
  );
  await page.getByRole("button", { name: "Bên trả hoa hồng" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(asked.includes("/partners")).toBe(false); // không đọc HD8 khi v2e
});

test("v2e · chi tiết: bảng Góp theo nhóm, các bước tới điểm cuối, biểu đồ có đường ngưỡng TỐT 85 / KHÁ 70, đổi 3/6/12 tháng", async ({
  page,
}) => {
  const { asked } = await install(page, "v2e");
  await page.goto(`/partners?party=${encodeURIComponent(A)}`);
  await page.getByRole("heading", { name: "NCC Minh An" }).waitFor();
  await expect(page.getByText("Điểm dữ liệu").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Giao đúng hạn" })).toBeVisible();
  await expect(page.getByText("Các bước tới điểm cuối")).toBeVisible();
  await expect(page.getByTestId("threshold-good")).toContainText("TỐT 85");
  await expect(page.getByTestId("threshold-fair")).toContainText("KHÁ 70");
  await expect(page.getByTestId("flag-panel")).toBeVisible(); // cờ đỏ giữ nguyên
  const req = page.waitForRequest(
    (r) => r.url().includes("/reputation/history") && r.url().includes("months=3"),
  );
  await page.getByRole("tab", { name: "3 tháng" }).click();
  await req;
  expect(asked.some((x) => x === "/partners/score")).toBe(false);
});

test("v2e · tab Đánh giá & ghi chú có đánh giá sao từng tiêu chí", async ({ page }) => {
  await install(page, "v2e");
  await page.goto(`/partners?party=${encodeURIComponent(A)}&tab=review`);
  await expect(page.getByRole("heading", { name: "Đánh giá thủ công" })).toBeVisible();
});

test("hd8 · chi tiết: bảng tiêu chí từ /partners/score, không biểu đồ lịch sử", async ({
  page,
}) => {
  await install(page, "hd8");
  await page.route("**/pack/contracts/partners/score*", (r) =>
    json(r, 200, {
      ...HD8_ROW,
      breakdown: { on_time: { label: "Giao đúng hạn", value: 80, detail: "4/5 đợt" } },
    }),
  );
  await page.goto(`/partners?party=${encodeURIComponent(A)}`);
  await page.getByRole("heading", { name: "NCC Minh An" }).waitFor();
  await expect(page.getByText("4/5 đợt")).toBeVisible();
  await expect(page.getByTestId("threshold-good")).toHaveCount(0);
});

// ---------------------------------------------------------------- Cài đặt
test("hd8 · Cài đặt: cách tính HD8 theo vai (có chỉnh tay ±10); quản lý thấy xem trước chuyển sang V2-E, chỉ đọc", async ({
  page,
}) => {
  const { sent } = await install(page, "hd8", "owner");
  const dlg = await openSettings(page);
  await expect(dlg.getByRole("radio", { name: "Khách hàng" })).toBeVisible();
  await expect(dlg.getByText("Cho chỉnh tay ±10 điểm (có lý do)")).toBeVisible();
  await expect(dlg.getByTestId("switch-count")).toContainText("2 đối tác đổi mức (3 trên 5 dòng");
  await expect(dlg.getByTestId("switch-moves")).toContainText("KHÁ → TỐT: 2");
  await expect(dlg.getByTestId("switch-note")).toContainText("quản trị hệ thống");
  expect(sent).toEqual([]); // xem trước chỉ đọc
  await expect(dlg.getByTestId("rep-v2e")).toHaveCount(0);
});

test("hd8 · người không phải quản lý: không có màn xem trước", async ({ page }) => {
  const { asked } = await install(page, "hd8", "editor");
  const dlg = await openSettings(page);
  await expect(dlg.getByRole("radio", { name: "Khách hàng" })).toBeVisible();
  await expect(dlg.getByTestId("switch-preview")).toHaveCount(0);
  expect(asked.includes("/reputation/switch-preview")).toBe(false);
});

test("v2e · Cài đặt: 5 ô nhóm × vai, 3 tab mỗi ô; ẩn cấu hình HD8 + chỉnh tay ±10; lưu mức gửi PUT /reputation/config/settings", async ({
  page,
}) => {
  const { sent } = await install(page, "v2e", "owner");
  const dlg = await openSettings(page);
  const v2e = dlg.getByTestId("rep-v2e");
  await expect(v2e).toBeVisible();
  for (const n of ["Nhà cung cấp", "Khách hàng", "Bên trả hoa hồng", "Mức & đánh giá"])
    await expect(v2e.getByRole("tab", { name: new RegExp(n) }).first()).toBeVisible();
  for (const n of ["Tiêu chí", "Thời gian", "Loại việc"])
    await expect(v2e.getByRole("tab", { name: n })).toBeVisible();
  await expect(dlg.getByRole("radio", { name: "Khách hàng" })).toHaveCount(0);
  await expect(dlg.getByText("Cho chỉnh tay ±10 điểm (có lý do)")).toHaveCount(0);
  await expect(dlg.getByTestId("scoring-customer")).toHaveCount(0);
  await expect(dlg.getByText("Điểm hiện hành đã là theo vai × nhóm sản phẩm")).toBeVisible();
  await v2e.getByRole("tab", { name: "Mức & đánh giá" }).click();
  await expect(dlg.getByLabel("TỐT từ")).toHaveValue("85");
  await expect(dlg.getByLabel("KHÁ từ")).toHaveValue("70");
  await expect(dlg.getByTestId("rep-save")).toBeDisabled();
  await dlg.getByLabel("TỐT từ").fill("90");
  await dlg.getByTestId("rep-save").click();
  await expect
    .poll(
      () => sent.find((s) => s.method === "PUT" && s.path === "/reputation/config/settings")?.body,
    )
    .toMatchObject({ good_from: 90, fair_from: 70, lock_period: "month" });
  expect(sent.some((s) => s.path.startsWith("/scoring/"))).toBe(false);
});

test("v2e · người không phải chủ sở hữu: cấu hình chỉ xem (ô khoá, không có Lưu)", async ({
  page,
}) => {
  await install(page, "v2e", "editor");
  const dlg = await openSettings(page);
  await expect(dlg.getByText("Chỉ chủ sở hữu hợp đồng được sửa cài đặt").first()).toBeVisible();
  await expect(dlg.getByLabel("Trọng số Giao đúng hạn")).toBeDisabled();
  await expect(dlg.getByTestId("rep-save")).toHaveCount(0);
});

// ---------------------------------------------------------------- Tổng quan
test("hd8 · Tổng quan: «Đối tác cần xem lại» (đọc /partners), không có khối Cần chú ý", async ({
  page,
}) => {
  const { asked } = await install(page, "hd8", "owner", true);
  await page.goto("/overview");
  await expect(page.getByText("Đối tác cần xem lại")).toBeVisible();
  await expect(page.getByTestId("attention-partners")).toHaveCount(0);
  expect(asked.includes("/reputation/attention")).toBe(false);
});

test("v2e · Tổng quan: khối «Cần chú ý» từ /reputation/attention — cờ đỏ lên đầu, lý do CHÚ Ý + giảm 8 điểm", async ({
  page,
}) => {
  const { asked } = await install(page, "v2e");
  await page.goto("/overview");
  const block = page.getByTestId("attention-partners");
  await expect(block.getByRole("listitem")).toHaveCount(2);
  await expect(block.getByRole("listitem").first().getByTestId("red-flag")).toContainText(
    "Gian lận",
  );
  const second = block.getByRole("listitem").nth(1);
  await expect(second.getByTestId("reason-watch")).toBeVisible();
  await expect(second.getByTestId("reason-drop")).toContainText("Giảm 8 điểm (3 tháng trước: 70)");
  expect(asked.includes("/reputation/attention")).toBe(true);
});

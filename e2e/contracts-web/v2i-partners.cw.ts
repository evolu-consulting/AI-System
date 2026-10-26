// V2-I · U3 · DT-01…07 · Đối tác UI (CR-097a) — danh sách `/partners` + trang chi tiết `/partners?party=` theo engine HD8 (hub giả như
// hd78-partners.cw.ts; KHÔNG chạy trong lát, chạy một lần ở cuối đợt): huy hiệu theo band, "MỚI · tạm tính" (điểm tạm), cờ đỏ tách khỏi
// điểm, báo cờ (lý do bắt buộc, quyền ghi) và gỡ cờ (chỉ quản lý, lý do bắt buộc), tab Hợp đồng lọc giai đoạn, ghi chú, "Tìm trên
// internet". Không còn ô sao / ghi `/reputation/*`. Mỗi nút gửi đúng API / thân.
import { expect, type Page, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";

const CAPTURE = process.env.CW_MODE === "capture";
const A = "tax:0301000001";
const B = "tax:0302000002";
const NOW = "2026-10-18";

const ROW = {
  party: A,
  name: "NCC Minh An",
  role: "supplier",
  roles: ["supplier"],
  score: 86,
  band: "good",
  reason: "Đúng hạn 5/6 đợt",
  event_count: 6,
  adjust: 0,
  contracts: 3,
};
const NEW_ROW = {
  ...ROW,
  party: B,
  name: "Công ty Mới Tinh",
  role: "customer",
  roles: ["customer"],
  score: null,
  band: null,
  provisional: true,
  provisional_score: 20,
  reason: "Mới 1 việc",
  event_count: 1,
  contracts: 1,
};
const FLAG_ROW = {
  ...ROW,
  red_flag: true,
  red_flags: [{ type: "fraud", n: 1 }],
};
const BREAKDOWN = {
  on_time: { label: "Giao đúng hạn", value: 80, detail: "Đúng hạn 4/5 đợt" },
  reminders: { label: "Ít phải nhắc", value: null, detail: null },
};
const FRAUD_EVENT = {
  id: "e1",
  party: A,
  role: "supplier",
  type: "fraud",
  at: "2026-10-10",
  by: "u1",
  by_name: "Lan",
  source: "action",
  contract_id: null,
  obligation_id: null,
  days_late: null,
  amount: null,
  note: "Giả chứng từ giao hàng",
  voided: false,
  voided_by: null,
  voided_at: null,
};
const CONTRACTS = [
  ["c1", "HĐ Minh An 01", "in_progress"],
  ["c2", "HĐ Minh An 02", "done"],
  ["c3", "HĐ Minh An 03", "not_started"],
].map(([id, title, stage]) => ({
  id,
  title,
  number: `MA-${id}`,
  deal: "buy",
  value: 100_000_000,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  stage,
  next:
    stage === "in_progress"
      ? { title: "Giao hàng đợt 2", due_date: "2026-10-30", overdue: false }
      : null,
}));
const WEB = {
  lines: [
    {
      title: "Đăng ký doanh nghiệp",
      summary: "Đang hoạt động, thành lập 2012",
      source: "masothue.com",
    },
    { title: "Website chính thức", summary: "Có trang giới thiệu", source: null },
  ],
};
const NOTE = {
  id: "n1",
  party: A,
  body: "Liên hệ chị Lan",
  source: "manual",
  by_user: "u1",
  by: "Lan",
  at: `${NOW}T02:00:00Z`,
};

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
type Sent = { method: string; path: string; body: unknown };
type Opts = {
  role?: Role;
  /** Dòng đối tác trả về theo `?role=` (mặc định: một NCC điểm TỐT). */
  rows?: Record<string, unknown>[];
  events?: unknown[];
  score?: Record<string, unknown>;
};

async function install(page: Page, o: Opts = {}): Promise<Sent[]> {
  const d = asHub(o.role ?? "owner");
  const sent: Sent[] = [];
  const rows = o.rows ?? [ROW];
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
      if (m !== "GET") {
        sent.push({ method: m, path: p, body: r.request().postDataJSON() });
        if (p === "/partners/internet-search") return json(r, 200, WEB);
        if (p === "/partner-events") return json(r, 201, { ...FRAUD_EVENT, id: "e2" });
        if (p.startsWith("/partner-events/")) return json(r, 200, { ...FRAUD_EVENT, voided: true });
        return json(r, 201, { ...NOTE, id: "n2" });
      }
      const role = url.searchParams.get("role");
      const byRole = rows.filter((x) => x.role === role);
      const table: Record<string, unknown> = {
        "/me": d.packMe,
        "/partners": byRole,
        "/partners/score": { ...(o.score ?? rows[0] ?? ROW), breakdown: BREAKDOWN },
        "/partner-events": o.events ?? [],
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
        "/partners/contracts": CONTRACTS,
        "/partners/notes": [NOTE],
        "/reputation/mine": {
          total: 0,
          late: 0,
          on_time_pct: 100,
          by_fault: { ours: 0, partner: 0, unknown: 0 },
          blamed: [],
        },
      };
      return p in table
        ? json(r, 200, table[p])
        : json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  return sent;
}

async function openDetail(page: Page, query = "") {
  await page.goto(`/partners?party=${encodeURIComponent(A)}${query}`);
  await page.getByRole("heading", { name: "NCC Minh An" }).waitFor();
}

test.skip(CAPTURE, "chỉ chạy trên contracts-web");

test("DT-01 · DT-02 · Tổng quan: đầu trang, huy hiệu, lý do, bảng tiêu chí từ /partners/score, link Cách tính điểm", async ({
  page,
}) => {
  await install(page);
  await openDetail(page);
  await expect(page.getByText("MST 0301000001 · — · Nguyễn Văn A")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tìm trên internet" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hợp đồng · 3" })).toBeVisible();
  await expect(page.locator("table").first().locator("thead th")).toHaveText([
    "Tiêu chí",
    "Điểm",
    "Dữ liệu",
  ]);
  await expect(page.getByText("Đúng hạn 5/6 đợt")).toBeVisible();
  await expect(page.getByText("Giao đúng hạn")).toBeVisible();
  await expect(page.getByText("Đúng hạn 4/5 đợt")).toBeVisible();
  await expect(page.getByRole("link", { name: /Cách tính điểm/ })).toBeVisible();
  await expect(page.getByTestId("red-flag")).toHaveCount(0);
  // Không còn ô sao / việc góp điểm kiểu cũ.
  await expect(page.getByRole("radio", { name: /sao/ })).toHaveCount(0);
});

test("R36 · danh sách: đối tác MỚI hiện điểm tạm kèm «MỚI · tạm tính» (không phải điểm thật)", async ({
  page,
}) => {
  const sent = await install(page, { rows: [ROW, NEW_ROW] });
  await page.goto("/partners");
  const row = page
    .getByTestId("partner-list")
    .getByRole("listitem")
    .filter({ hasText: "Công ty Mới Tinh" });
  await expect(row).toContainText("20");
  await expect(row).toContainText("MỚI · tạm tính");
  await expect(
    page.getByTestId("partner-list").getByRole("listitem").filter({ hasText: "NCC Minh An" }),
  ).toContainText("TỐT");
  expect(sent).toEqual([]); // chỉ đọc
});

test("R36 · chi tiết đối tác MỚI: ghi chú «MỚI · tạm tính» + điểm tạm", async ({ page }) => {
  await install(page, { rows: [{ ...ROW, ...NEW_ROW, party: A, role: "supplier" }] });
  await openDetail(page);
  await expect(page.getByText(/MỚI · tạm tính: điểm tạm 20/)).toBeVisible();
});

test("R39 · danh sách: cờ đỏ hiện nhãn Gian lận kể cả khi điểm TỐT; lọc «Có cờ đỏ» chỉ còn đối tác có cờ", async ({
  page,
}) => {
  await install(page, { rows: [FLAG_ROW, { ...NEW_ROW }] });
  await page.goto("/partners");
  const flagged = page
    .getByTestId("partner-list")
    .getByRole("listitem")
    .filter({ hasText: "NCC Minh An" });
  await expect(flagged.getByTestId("red-flag")).toContainText("Cờ đỏ · Gian lận");
  await expect(flagged).toContainText("TỐT");
  await expect(page.getByTestId("partner-list").getByRole("listitem").first()).toContainText(
    "NCC Minh An",
  ); // cờ đỏ lên đầu
  await page.getByRole("button", { name: "Có cờ đỏ" }).click();
  await expect(page.getByTestId("partner-list").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("partner-list").getByRole("listitem")).toContainText("NCC Minh An");
});

test("UT-FR-13 · báo cờ đỏ: lý do bắt buộc (nút khoá tới khi có chữ), editor gửi POST /partner-events {type, note}", async ({
  page,
}) => {
  const sent = await install(page, { role: "editor" });
  await openDetail(page);
  const panel = page.getByTestId("flag-panel");
  await expect(panel).toContainText("Đối tác chưa có cờ đỏ.");
  const send = panel.getByRole("button", { name: "Báo cờ", exact: true });
  await expect(send).toBeDisabled();
  await panel.getByLabel("Loại cờ").selectOption("no_delivery");
  await panel.getByLabel("Lý do").fill("Không giao lô 2 dù đã thu tiền");
  await send.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/partner-events",
    body: {
      party: A,
      role: "supplier",
      type: "no_delivery",
      at: NOW,
      note: "Không giao lô 2 dù đã thu tiền",
    },
  });
});

test("R39 · chi tiết có cờ đỏ: nhãn + dòng việc nghiêm trọng; editor không có nút Gỡ cờ", async ({
  page,
}) => {
  await install(page, { role: "editor", rows: [FLAG_ROW], events: [FRAUD_EVENT] });
  await openDetail(page);
  await expect(page.getByTestId("red-flag").first()).toContainText("Gian lận");
  await expect(page.getByTestId("flag-panel")).toContainText("Giả chứng từ giao hàng");
  await expect(page.getByRole("button", { name: "Gỡ cờ" })).toHaveCount(0);
});

test("UT-FR-13 · gỡ cờ (quản lý): bắt buộc lý do, gửi POST /partner-events/:id/void {reason}", async ({
  page,
}) => {
  const sent = await install(page, { role: "owner", rows: [FLAG_ROW], events: [FRAUD_EVENT] });
  await openDetail(page);
  await page.getByRole("button", { name: "Gỡ cờ" }).click();
  await expect(page.getByRole("button", { name: "Huỷ việc này" })).toBeDisabled();
  await page.getByLabel("Lý do huỷ").fill("Đã đối chiếu, nhầm đối tác");
  await page.getByRole("button", { name: "Huỷ việc này" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/partner-events/e1/void",
    body: { reason: "Đã đối chiếu, nhầm đối tác" },
  });
});

test("DT-06 · tab Hợp đồng lọc Chưa bắt đầu / Đang thực hiện / Đã xong", async ({ page }) => {
  await install(page);
  await openDetail(page, "&tab=contracts");
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: /Đang thực hiện · 1/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Giao hàng đợt 2");
  await page.getByRole("button", { name: /Đã xong · 1/ }).click();
  await expect(rows.first()).toContainText("HĐ Minh An 02");
  await page.getByRole("button", { name: /Chưa bắt đầu · 1/ }).click();
  await expect(rows.first()).toContainText("HĐ Minh An 03");
});

test("DT-05 · ghi chú gửi đúng API (tab Sổ việc & ghi chú, không còn ô sao)", async ({ page }) => {
  const sent = await install(page);
  await openDetail(page, "&tab=review");
  await expect(page.getByRole("radio", { name: /sao/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Ghi chú", exact: true }).fill("Gọi lại thứ Hai");
  await page.getByRole("button", { name: "Lưu ghi chú" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/partners/notes",
    body: { party: A, body: "Gọi lại thứ Hai" },
  });
  expect(sent.some((s) => s.path.includes("/reputation/"))).toBe(false);
});

test("DT-07 · Tìm trên internet: chỉ gửi khi bấm, gửi {party}; lưu một dòng vào ghi chú (nguồn internet)", async ({
  page,
}) => {
  const sent = await install(page);
  await openDetail(page);
  expect(sent).toEqual([]); // chưa bấm ⇒ chưa gọi
  await page.getByRole("button", { name: "Tìm trên internet" }).click();
  await expect(page.getByText("Đăng ký doanh nghiệp")).toBeVisible();
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/partners/internet-search",
    body: { party: A },
  });
  await page.getByRole("button", { name: "Lưu vào ghi chú" }).first().click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({
    method: "POST",
    path: "/partners/notes",
    body: {
      party: A,
      body: "Đăng ký doanh nghiệp: Đang hoạt động, thành lập 2012 (masothue.com)",
      source: "internet",
    },
  });
});

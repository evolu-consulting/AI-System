// V2-I · DT-01…07 · Đối tác UI v2 — hành vi trang chi tiết `/partners?party=` (hub giả như hd78-partners.cw.ts; KHÔNG chạy trong lát,
// chạy một lần ở cuối đợt): bảng tính điểm Tiêu chí · Điểm · Trọng số · Góp · Dữ liệu, bấm tiêu chí ⇒ liệt kê việc, các bước tới điểm
// cuối, biểu đồ có đường ngưỡng TỐT/KHÁ, tab Hợp đồng lọc giai đoạn, sao + lý do (lệch > 25 điểm), ghi chú, "Tìm trên internet" chỉ gửi
// khi bấm và lưu dòng vào ghi chú. Mỗi nút gửi đúng API / thân.
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";

const CAPTURE = process.env.CW_MODE === "capture";
const A = "tax:0301000001";
const NOW = "2026-10-18";

const crit = (key: string, label: string, weight: number, score: number | null, n: number) => ({
  key,
  label,
  kind: "ontime",
  weight,
  score,
  n,
});
const CELL = {
  group: "service",
  role: "supplier",
  score: 86,
  data_score: 90,
  stars: 3.5,
  level: "good",
  jobs: 6,
  value: 100_000_000,
  criteria: [
    crit("on_time_delivery", "Giao đúng hạn", 40, 80, 4),
    crit("serial", "Cấp serial", 40, 100, 2),
    crit("incident", "Xử lý sự cố", 20, null, 0),
  ],
};
const DETAIL = {
  party: A,
  name: "NCC Minh An",
  role: "supplier",
  score: 86,
  level: "good",
  jobs: 6,
  groups: [CELL],
  items: [
    {
      source: "milestone",
      id: "m1",
      group: "service",
      criterion: "on_time_delivery",
      at: "2026-09-02",
      score: 90,
      h: 1,
      label: "Giao hàng đợt 1",
      late_days: 5,
      fault: "partner",
      contract_id: "c1",
      contract: "HĐ Minh An 01",
    },
  ],
};
const HISTORY = {
  party: A,
  role: "supplier",
  months: 12,
  thresholds: { good_from: 85, fair_from: 70 },
  points: [
    { period: "2026-08", score: 78, level: "fair", jobs: 4 },
    { period: "2026-09", score: 82, level: "fair", jobs: 5 },
  ],
  current: { period: "2026-10", score: 86, level: "good", jobs: 6 },
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

async function open(page: Page, query = ""): Promise<Sent[]> {
  const d = asHub("owner");
  const sent: Sent[] = [];
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
        if (p === "/partners/internet-search") {
          sent.push({ method: m, path: p, body: r.request().postDataJSON() });
          return json(r, 200, WEB);
        }
        sent.push({ method: m, path: p, body: r.request().postDataJSON() });
        return json(r, 201, { ...NOTE, id: "n2" });
      }
      const table: Record<string, unknown> = {
        "/me": d.packMe,
        "/reputation/partners": [
          {
            party: A,
            name: "NCC Minh An",
            role: "supplier",
            score: 86,
            level: "good",
            jobs: 6,
            groups: [],
          },
        ],
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
        "/reputation/partner": DETAIL,
        "/reputation/history": HISTORY,
        "/reputation/config": {
          settings: {
            good_from: 85,
            fair_from: 70,
            min_jobs: 3,
            manual_share: 20,
            reason_gap: 25,
            lock_period: "month",
          },
        },
        "/reputation/ratings": { current: [], history: [] },
        "/partners/contracts": CONTRACTS,
        "/partners/notes": [NOTE],
      };
      return p in table
        ? json(r, 200, table[p])
        : json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/partners?party=${encodeURIComponent(A)}${query}`);
  await page.getByRole("heading", { name: "NCC Minh An" }).waitFor();
  return sent;
}

test.skip(CAPTURE, "chỉ chạy trên contracts-web");

test("DT-01 · DT-02 · DT-03 · Tổng quan: đầu trang, bảng Góp, bấm tiêu chí ⇒ việc, các bước, đường ngưỡng", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("MST 0301000001 · — · Nguyễn Văn A")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tìm trên internet" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hợp đồng · 3" })).toBeVisible();
  const head = page.locator("table").first().locator("thead th");
  await expect(head).toHaveText(["Tiêu chí", "Điểm", "Trọng số", "Góp", "Dữ liệu"]);
  // trọng số chia lại sau khi bỏ "Xử lý sự cố" (chưa có dữ liệu): 40/80 ⇒ 50% × 80 = 40; 50% × 100 = 50; điểm dữ liệu 90
  await expect(page.locator("tfoot")).toContainText("90");
  await page.getByRole("button", { name: "Giao đúng hạn" }).click();
  await expect(page.getByRole("region", { name: /Việc góp điểm/ })).toContainText(
    "Giao hàng đợt 1",
  );
  await expect(page.getByRole("region", { name: /Việc góp điểm/ })).toContainText("Trễ 5 ngày");
  await expect(page.getByRole("region", { name: "Các bước tới điểm cuối" })).toContainText(
    "trộn 80% × 90 + 20% × 70",
  );
  await expect(page.getByTestId("threshold-good")).toContainText("TỐT 85");
  await expect(page.getByTestId("threshold-fair")).toContainText("KHÁ 70");
  await page.getByRole("tab", { name: "3 tháng" }).click();
  await expect(page).toHaveURL(/range=3/);
});

test("DT-06 · tab Hợp đồng lọc Chưa bắt đầu / Đang thực hiện / Đã xong", async ({ page }) => {
  await open(page, "&tab=contracts");
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

test("DT-04 · DT-05 · sao 1–5 (lệch > 25 điểm cần lý do) + ghi chú gửi đúng API", async ({
  page,
}) => {
  const sent = await open(page, "&tab=review");
  const row = page.locator("div.rounded-lg", { hasText: "Giao đúng hạn" }).first();
  await row.getByRole("radio", { name: "5 sao" }).click(); // 100 so với dữ liệu 80 = lệch 20 ⇒ chưa bắt lý do
  await row.getByRole("button", { name: "Lưu đánh giá" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/reputation/ratings",
    body: {
      party: A,
      role: "supplier",
      group: "service",
      criterion: "on_time_delivery",
      stars: 5,
      reason: null,
    },
  });
  const low = page.locator("div.rounded-lg", { hasText: "Cấp serial" }).first();
  await low.getByRole("radio", { name: "1 sao" }).click(); // 20 so với dữ liệu 100 = lệch 80 ⇒ bắt lý do
  await expect(low.getByRole("button", { name: "Lưu đánh giá" })).toBeDisabled();
  await low.getByLabel("Lý do đánh giá Cấp serial").fill("Chậm kích hoạt nhiều lần");
  await low.getByRole("button", { name: "Lưu đánh giá" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.body).toMatchObject({
    criterion: "serial",
    stars: 1,
    reason: "Chậm kích hoạt nhiều lần",
  });
  await page.getByLabel("Ghi chú").first().fill("Gọi lại thứ Hai");
  await page.getByRole("button", { name: "Lưu ghi chú" }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toEqual({
    method: "POST",
    path: "/partners/notes",
    body: { party: A, body: "Gọi lại thứ Hai" },
  });
});

test("DT-07 · Tìm trên internet: chỉ gửi khi bấm, gửi {party}; lưu một dòng vào ghi chú (nguồn internet)", async ({
  page,
}) => {
  const sent = await open(page);
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

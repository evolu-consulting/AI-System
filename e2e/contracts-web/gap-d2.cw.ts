// GAP-D2 · #23 "Thêm công ty" (tra Cục Thuế chỉ gửi MST) · #24 nhiều người liên hệ · #25 huỷ việc kèm lý do · #27 xu hướng 6 tháng +
// "Cảnh báo bất thường" — hub giả như v2i-partners.cw.ts (KHÔNG chạy trong lát; chạy một lần ở cuối đợt). Mỗi nút gửi đúng API / thân.
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";

const A = "tax:0301000001";
const NOW = "2026-10-18";

const CELL = {
  group: "goods",
  role: "supplier",
  score: 70,
  data_score: 70,
  stars: null,
  level: "fair",
  jobs: 2,
  value: 1,
  criteria: [
    { key: "ontime", label: "Giao đúng hạn", kind: "ontime", weight: 100, score: 70, n: 2 },
  ],
};
const DETAIL = {
  party: A,
  name: "NCC Minh An",
  role: "supplier",
  score: 70,
  level: "fair",
  jobs: 2,
  groups: [CELL],
  items: [
    {
      source: "job",
      id: "777",
      group: "goods",
      criterion: "ontime",
      at: "2026-10-10",
      score: 40,
      h: 1,
      label: "Hàng lỗi lô 3",
      contract_id: null,
      note: "ghi tay",
    },
  ],
};
// điểm tụt 90 → 78 giữa hai tháng ⇒ cảnh báo "Điểm tụt"
const HISTORY = {
  party: A,
  role: "supplier",
  months: 6,
  thresholds: { good_from: 85, fair_from: 70 },
  points: [
    { period: "2026-08", score: 88, level: "good", jobs: 4 },
    { period: "2026-09", score: 90, level: "good", jobs: 5 },
  ],
  current: { period: "2026-10", score: 78, level: "fair", jobs: 6 },
};
const CONTACTS = [
  {
    id: "c1",
    name: "Chị Lan",
    role: "Kinh doanh",
    phone: "0903 111 222",
    email: "lan@x.vn",
    our_owner: "Hoa",
  },
];

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
type Sent = { method: string; path: string; body: unknown };

async function open(page: Page, url: string, extra: Record<string, unknown> = {}): Promise<Sent[]> {
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
      const p = new URL(r.request().url()).pathname.replace("/pack/contracts", "");
      const m = r.request().method();
      if (m !== "GET") {
        sent.push({ method: m, path: p, body: r.request().postDataJSON() });
        if (p === "/companies")
          return json(r, 201, {
            party: "tax:0312345678",
            tax_id: "0312345678",
            name: "CÔNG TY TNHH MẪU",
            address: "1 Lê Lợi, Q.1",
            status: "Đang hoạt động",
            active: true,
            registry_result: "found",
            edited: [],
            short_name: null,
            international_name: null,
            created_from: "manual",
          });
        if (p === "/partners/contacts")
          return json(r, 200, (r.request().postDataJSON() as { contacts: unknown[] }).contacts);
        return json(r, 200, { ok: true });
      }
      const table: Record<string, unknown> = {
        "/me": d.packMe,
        "/reputation/partners": [
          {
            party: A,
            name: "NCC Minh An",
            role: "supplier",
            score: 70,
            level: "fair",
            jobs: 2,
            groups: [],
          },
        ],
        "/partners/contract-counts": [{ party: A, n: 1 }],
        "/partners/profile": {
          party: A,
          name: "NCC Minh An",
          tax_id: "0301000001",
          phone: "0903 111 222",
          contact: "Chị Lan",
        },
        "/partners/roles": [
          {
            party: A,
            role: "supplier",
            name: "NCC Minh An",
            events: 2,
            min_events: 3,
            is_new: false,
          },
        ],
        "/partners/contacts": CONTACTS,
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
        "/reputation/mine": {
          total: 0,
          late: 0,
          on_time_pct: 100,
          by_fault: { ours: 0, partner: 0, unknown: 0 },
          blamed: [],
        },
        ...extra,
      };
      return p in table
        ? json(r, 200, table[p])
        : json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  return sent;
}

test("#27 · tab Tổng quan có xu hướng 6 tháng và Cảnh báo bất thường (điểm tụt 90 → 78)", async ({
  page,
}) => {
  await open(page, `/partners?party=${encodeURIComponent(A)}`);
  const box = page.getByRole("region", { name: "Xu hướng 6 tháng" });
  await expect(box.getByRole("img")).toBeVisible();
  await expect(box.getByText("Cảnh báo bất thường")).toBeVisible();
  await expect(box).toContainText("Điểm tụt từ 90 xuống 78");
});

test("#25 · huỷ một việc ghi tay ở danh sách việc góp điểm: bắt buộc lý do, gửi {reason}", async ({
  page,
}) => {
  const sent = await open(page, `/partners?party=${encodeURIComponent(A)}`);
  await page.getByRole("button", { name: "Giao đúng hạn" }).click();
  await page.getByRole("button", { name: "Huỷ việc: Hàng lỗi lô 3" }).click();
  await expect(page.getByRole("button", { name: "Huỷ việc này" })).toBeDisabled();
  await page.getByLabel("Lý do huỷ").fill("Ghi nhầm đối tác");
  await page.getByRole("button", { name: "Huỷ việc này" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/partner-events/777/void",
    body: { reason: "Ghi nhầm đối tác" },
  });
});

test("#24 · nhiều người liên hệ: hiện danh sách, thêm người, lưu thay cả danh sách", async ({
  page,
}) => {
  const sent = await open(page, `/partners?party=${encodeURIComponent(A)}`);
  const list = page.getByRole("list", { name: "Điện thoại và người liên hệ" });
  await expect(list).toContainText("Chị Lan");
  await expect(list).toContainText("Phụ trách bên mình: Hoa");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await page.getByRole("button", { name: "+ Thêm người liên hệ" }).click();
  await page.getByLabel("Họ tên 2").fill("Anh Minh");
  await page.getByLabel("Email 2").fill("minh@x.vn");
  await page
    .getByRole("form", { name: "Điện thoại và người liên hệ" })
    .getByRole("button", { name: "Lưu" })
    .click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "PUT",
    path: "/partners/contacts",
    body: {
      party: A,
      contacts: [
        {
          name: "Chị Lan",
          role: "Kinh doanh",
          phone: "0903 111 222",
          email: "lan@x.vn",
          our_owner: "Hoa",
        },
        { name: "Anh Minh", role: null, phone: null, email: "minh@x.vn", our_owner: null },
      ],
    },
  });
});

test("#23 · Thêm công ty: gõ MST ⇒ chỉ gửi MST, hiện tên/địa chỉ theo Cục Thuế", async ({
  page,
}) => {
  const sent = await open(page, "/partners");
  await page.getByRole("button", { name: "Thêm công ty" }).click();
  await page.getByLabel("Mã số thuế").fill("0312345678");
  await page.getByRole("button", { name: "Tra Cục Thuế và thêm" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ method: "POST", path: "/companies", body: { tax_id: "0312345678" } });
  await expect(page.getByRole("status")).toContainText("CÔNG TY TNHH MẪU");
  await expect(page.getByRole("status")).toContainText("Đang hoạt động theo Cục Thuế");
});

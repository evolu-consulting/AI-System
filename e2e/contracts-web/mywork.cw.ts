// W1 · nav-v2 · "Việc của tôi" nay là khối «Cần xử lý» của Tổng quan (`/overview`; `/my-work` chuyển hướng) · Luật 4b: nhãn mức gấp, nút hành
// động đúng quyền (Đã thu / Khách hẹn lại / Xong / Nhắc lại sau / ghi kết quả HĐ), POST đúng thân rồi tải lại, menu mới. Backend giả
// `page.route`. Phần 6 việc + «Xem thêm», khối Hợp đồng / Đối tác: `overview.cw.ts`. Chỉ kiểm hành vi (cảnh ảnh ở `scenes.cw.ts`).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { facetsAsHub } from "./dataset-list";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Sent = { method: string; path: string; body: unknown };
const base = {
  at: null,
  title: null,
  party: null,
  amount: null,
  direction: null,
  contract_direction: null,
  contract_id: null,
  customer_id: null,
  note: null,
  milestone: null,
  subject: null,
};
const item = (o: Record<string, unknown>) => ({ ...base, ...o });
const CID = "c1000000-0000-4000-8000-000000000001";
const ITEMS = [
  item({
    id: "obligation:o1",
    kind: "obligation",
    tone: "late",
    days: 3,
    due: "2026-10-17",
    title: "S-1",
    party: "Khách An",
    amount: 5_000_000,
    direction: "receive",
    contract_direction: "sale",
    contract_id: CID,
  }),
  item({
    id: "obligation:o2",
    kind: "obligation",
    tone: "soon",
    days: 0,
    due: "2026-10-20",
    title: "M-1",
    party: "NCC Bình",
    amount: 1_000_000,
    direction: "pay",
    contract_direction: "purchase",
    contract_id: CID,
  }),
  item({
    id: "followup:f1",
    kind: "followup",
    tone: "soon",
    days: 0,
    due: "2026-10-20",
    at: "2026-10-20T08:30",
    title: "Bếp Việt",
    note: "Gọi lại",
    customer_id: "k1",
    subject: "customer",
  }),
  item({
    id: `deadline:${CID}`,
    kind: "deadline",
    tone: "dim",
    days: -2,
    due: "2026-10-22",
    title: "M-2",
    party: "NCC Hai",
    contract_direction: "purchase",
    contract_id: CID,
  }),
];
const out = (items: unknown[]) => ({
  today: "2026-10-20",
  items,
  counts: { late: 1, today: 2, upcoming: 1 },
  truncated: false,
});

async function install(page: Page, role: Role, items: unknown[] = ITEMS) {
  const sent: Sent[] = [];
  let current = items;
  const d = asHub(role);
  const json = (r: Route, code: number, body: unknown) =>
    r.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/my-work", (r) => json(r, 200, out(current)));
  // Khối Hợp đồng / Đối tác của Tổng quan: dữ liệu rỗng, không liên quan tới các ca việc ở đây.
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts/facets",
    (r) => json(r, 200, facetsAsHub()),
  );
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => json(r, 200, { items: [], total: 0, parents: [], page: 1, page_size: 3 }),
  );
  await page.route(
    (u) => u.pathname === "/pack/contracts/partners",
    (r) => json(r, 200, []),
  );
  await page.route("**/pack/contracts/followups", (r) => {
    const req = r.request();
    sent.push({
      method: req.method(),
      path: new URL(req.url()).pathname,
      body: req.postDataJSON(),
    });
    return json(r, 201, { id: "g-new" });
  });
  await page.route(
    /\/pack\/contracts\/(my-work\/followups|obligations|contracts)\/[^/]+\/[a-z]+$/,
    (r) => {
      const req = r.request();
      const path = new URL(req.url()).pathname;
      sent.push({ method: req.method(), path, body: req.postDataJSON() });
      const id = path.split("/").at(-2);
      current = current.filter((i) => !(i as { id: string }).id.endsWith(`:${id}`));
      return json(r, 200, { ok: true });
    },
  );
  return sent;
}

test("/my-work chuyển về Tổng quan; «Cần xử lý» liệt kê việc với nhãn mức gấp và đếm quá hạn", async ({
  page,
}) => {
  await install(page, "editor");
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Tổng quan", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cần xử lý", level: 2 })).toBeVisible();
  await expect(page.getByText("4 việc · 1 quá hạn")).toBeVisible();
  await expect(page.getByTestId("work-row")).toHaveCount(4);
  await expect(page.getByTestId("work-row").filter({ hasText: "Thu tiền Khách An" })).toContainText(
    "Trễ 3 ngày",
  );
  await expect(page.getByTestId("work-row").filter({ hasText: "Gọi lại Bếp Việt" })).toContainText(
    "Hôm nay",
  );
  await expect(page.getByTestId("work-row").filter({ hasText: "M-2" })).toContainText("Còn 2 ngày");
});
test("Đã thu ⇒ POST /obligations/:id/settle rồi tải lại (hàng biến mất)", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/overview");
  const row = page.getByTestId("work-row").filter({ hasText: "Thu tiền Khách An" });
  await row.getByRole("button", { name: "Đã thu" }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(3);
  expect(sent).toEqual([
    { method: "POST", path: "/pack/contracts/obligations/o1/settle", body: {} },
  ]);
});

test("Khách hẹn lại: ô ngày mặc định +7 ngày, xác nhận ⇒ POST /postpone {to}", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/overview");
  const row = page.getByTestId("work-row").filter({ hasText: "Thu tiền Khách An" });
  await row.getByRole("button", { name: "Khách hẹn lại" }).click();
  const date = row.getByLabel("Ngày khách hẹn");
  await expect(date).toHaveValue("2026-10-27");
  await date.fill("2026-10-16"); // trước hạn ⇒ không cho xác nhận
  await expect(row.getByRole("button", { name: "Đồng ý" })).toBeDisabled();
  await date.fill("2026-10-30");
  await row.getByRole("button", { name: "Đồng ý" }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(3);
  expect(sent).toEqual([
    { method: "POST", path: "/pack/contracts/obligations/o1/postpone", body: { to: "2026-10-30" } },
  ]);
});

test("hẹn nhắc: Xong và Nhắc lại sau (giờ mặc định 09:00 ngày mai)", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/overview");
  const row = page.getByTestId("work-row").filter({ hasText: "Bếp Việt" });
  await row.getByRole("button", { name: "Nhắc lại sau" }).click();
  await expect(row.getByLabel("Nhắc lại lúc")).toHaveValue("2026-10-21T09:00");
  await row.getByRole("button", { name: "Đồng ý" }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(3);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/pack/contracts/my-work/followups/f1/snooze",
    body: { at: "2026-10-21T09:00" },
  });
});

test("hạn xử lý HĐ mua: ghi kết quả ⇒ POST /handled; có liên kết So sánh giá", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/overview");
  const row = page.getByTestId("work-row").filter({ hasText: "M-2" });
  await expect(row.getByRole("link", { name: "So sánh giá" })).toBeVisible();
  await row.getByRole("combobox").selectOption("negotiating");
  await expect(page.getByTestId("work-row")).toHaveCount(3);
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/pack/contracts/contracts/${CID}/handled`,
      body: { outcome: "negotiating" },
    },
  ]);
});

test("người xem: không có nút ghi sổ/HĐ, nhưng vẫn đóng được hẹn nhắc của mình", async ({
  page,
}) => {
  await install(page, "viewer");
  await page.goto("/overview");
  await expect(page.getByTestId("work-row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Đã thu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đã trả" })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xong" })).toBeVisible();
});

test("rỗng ⇒ «Không có việc cần xử lý»; menu chỉ còn 4 mục, «Tổng quan» sáng", async ({ page }) => {
  await install(page, "editor", []);
  await page.goto("/overview");
  await expect(page.getByText("Không có việc cần xử lý.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Tổng quan" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Việc của tôi" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Mua hàng" })).toHaveCount(0);
});
test("hẹn nhắc chung: hiện tiêu đề máy chủ đặt; «Hẹn nhắc» trên đợt ⇒ POST /followups đúng thân; hẹn nhắc chung Xong được", async ({
  page,
}) => {
  const generic = item({
    id: "followup:g1",
    kind: "followup",
    tone: "soon",
    days: 0,
    due: "2026-10-20",
    at: "2026-10-20T10:00",
    title: "Thu Khách An 5.000.000 đ",
    subject: "obligation",
    contract_id: CID,
  });
  const sent = await install(page, "editor", [generic, ITEMS[0]]);
  await page.goto("/overview");
  const row = page.getByTestId("work-row").filter({ hasText: "Thu Khách An 5.000.000 đ" });
  await expect(row).toContainText("10:00");
  await expect(row.getByRole("button", { name: "Xong" })).toBeVisible();
  const ob = page.getByTestId("work-row").filter({ hasText: "Thu tiền Khách An" });
  await ob.getByRole("button", { name: "Hẹn nhắc" }).click();
  await expect(ob.getByLabel("Nhắc tôi lúc")).toHaveValue("2026-10-21T09:00");
  await ob.getByRole("button", { name: "Đồng ý" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: "POST",
    path: "/pack/contracts/followups",
    body: { subject_kind: "obligation", subject_id: "o1", at: "2026-10-21T09:00" },
  });
  await row.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(1);
});

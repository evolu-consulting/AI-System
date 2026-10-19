// W1 · "Việc của tôi" (/my-work) · Luật 4b: danh sách nhóm theo mức gấp, nút hành động đúng quyền (Đã thu / Khách hẹn lại / Xong / Nhắc lại
// sau / ghi kết quả HĐ), POST đúng thân rồi tải lại, mục menu mới. Backend giả `page.route`. mgmt-app không có màn riêng (việc nằm ở
// thẻ trợ lý) ⇒ không có cảnh so ảnh (DEVIATIONS.md).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";

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

test("nhóm theo mức gấp, 3 ô số, chip lọc theo loại", async ({ page }) => {
  await install(page, "editor");
  await page.goto("/my-work");
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Việc của tôi", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("work-row")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Trễ hạn" })).toContainText("Thu tiền Khách An");
  await expect(page.getByRole("region", { name: "Trễ hạn" })).toContainText("Trễ 3 ngày");
  await expect(page.getByRole("region", { name: "Hôm nay" })).toContainText("Gọi lại Bếp Việt");
  await expect(page.getByRole("region", { name: "Sắp tới" })).toContainText("Còn 2 ngày");
  await page.getByRole("button", { name: /^Thanh toán/ }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(2);
  await page.getByRole("button", { name: /^Hẹn nhắc \(\d+\)/ }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(1);
});

test("Đã thu ⇒ POST /obligations/:id/settle rồi tải lại (hàng biến mất)", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/my-work");
  const row = page.getByTestId("work-row").filter({ hasText: "Thu tiền Khách An" });
  await row.getByRole("button", { name: "Đã thu" }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(3);
  expect(sent).toEqual([
    { method: "POST", path: "/pack/contracts/obligations/o1/settle", body: {} },
  ]);
});

test("Khách hẹn lại: ô ngày mặc định +7 ngày, xác nhận ⇒ POST /postpone {to}", async ({ page }) => {
  const sent = await install(page, "editor");
  await page.goto("/my-work");
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
  await page.goto("/my-work");
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
  await page.goto("/my-work");
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
  await page.goto("/my-work");
  await expect(page.getByTestId("work-row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Đã thu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đã trả" })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xong" })).toBeVisible();
});

test("rỗng ⇒ thông báo không có việc; menu có «Việc của tôi» và «Mua hàng»", async ({ page }) => {
  await install(page, "editor", []);
  await page.goto("/my-work");
  await expect(page.getByText("Không có việc nào cần làm")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Việc của tôi" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Mua hàng" })).toBeAttached();
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
  await page.goto("/my-work");
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

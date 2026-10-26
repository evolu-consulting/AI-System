// CR-097 G2 · GD-FR-01…05 · Luật 4b: màn Giao dịch của contracts-web — menu, danh sách + lọc, tạo nháp, ghi sổ (kho trước → sau,
// lỗi TRANSACTION_STOCK), chi tiết đã ghi sổ (mô tả, điều chỉnh/huỷ cần lý do, dòng thời gian, nghĩa vụ), khối "Giao dịch liên kết"
// ở trang HĐ. Backend giả `page.route` (không máy chủ thật); không sleep. File này CHỈ được viết, chưa chạy trong lát G2.
import { expect, type Page, type Route, test } from "@playwright/test";
import { ACTIVE_ID, P_TOKEN } from "./dataset-v2f";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const TX_DRAFT = "f1000000-0000-4000-8000-000000000001";
const TX_POSTED = "f1000000-0000-4000-8000-000000000002";
const COMP = P_TOKEN.components[0]?.id ?? "";

const line = {
  id: "f2000000-0000-4000-8000-000000000001",
  ord: 0,
  name: "USB Token",
  product_id: P_TOKEN.id,
  component_ids: [COMP],
  unit: "cái",
  qty: "3",
  unit_price: 500_000,
  amount: 1_500_000,
};
const summary = (id: string, status: string, over: object = {}) => ({
  id,
  deal: "sell",
  status,
  rev: 1,
  occurred_on: "2026-10-18",
  due_on: "2026-11-18",
  partner_name: "Công ty An Phát",
  party_key: null,
  contract_id: null,
  total: 1_500_000,
  lot_label: null,
  updated_at: "2026-10-18T03:00:00Z",
  ...over,
});
const detail = (id: string, status: string, over: object = {}) => ({
  ...summary(id, status),
  valid_until: null,
  partner_tax_id: null,
  product_group: "goods",
  note: null,
  holder: null,
  created_by: null,
  created_at: "2026-10-18T02:00:00Z",
  posted_at: status === "posted" ? "2026-10-18T03:00:00Z" : null,
  cancelled_at: null,
  cancel_reason: null,
  lines: [line],
  obligations:
    status === "posted"
      ? [
          {
            id: "f3000000-0000-4000-8000-000000000001",
            direction: "receive",
            seq: 1,
            due_date: "2026-11-18",
            amount: 1_500_000,
            status: "open",
            cancel_reason: null,
          },
        ]
      : [],
  events: [
    {
      id: "ev1",
      type: "created",
      actor_user_id: null,
      reason: null,
      data: { total: 1_500_000, lines: 1 },
      at: "2026-10-18T02:00:00Z",
    },
    ...(status === "posted"
      ? [
          {
            id: "ev2",
            type: "posted",
            actor_user_id: null,
            reason: null,
            data: {},
            at: "2026-10-18T03:00:00Z",
          },
        ]
      : []),
  ],
  ...over,
});
const stock = [
  {
    component_id: COMP,
    on_hand_before: "10",
    on_hand_after: "7",
    avg_cost_before: 100_000,
    avg_cost_after: 100_000,
  },
];

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type Opts = { postError?: boolean; linked?: boolean };
type Reply = [status: number, body: unknown] | null;
const STOCK_ERR = {
  error: { code: "TRANSACTION_STOCK", message: "Kho USB Token không đủ: cần 3, còn 2" },
};
const act = (tx: unknown, reversed = 1): Reply => [
  200,
  { transaction: tx, stock, stock_reversed: reversed },
];

function listReply(u: URL, o: Opts): Reply {
  const cid = u.searchParams.get("contract_id");
  const items =
    cid && !o.linked
      ? []
      : [
          summary(TX_DRAFT, "draft", cid ? { contract_id: cid } : {}),
          summary(TX_POSTED, "posted", { deal: "buy", partner_name: "Bao Bì Phương Nam" }),
        ];
  return [200, { items, total: items.length, page: 1, limit: 20 }];
}

/** Bảng trả lời theo `METHOD /đường-dẫn` (sau `/transactions`). */
function reply(method: string, path: string, u: URL, o: Opts): Reply {
  const table: Record<string, () => Reply> = {
    "GET ": () => listReply(u, o),
    "POST ": () => [201, detail(TX_DRAFT, "draft")],
    [`POST /${TX_DRAFT}/post`]: () =>
      o.postError ? [409, STOCK_ERR] : act(detail(TX_DRAFT, "posted"), 0),
    [`POST /${TX_POSTED}/adjust`]: () => act(detail(TX_POSTED, "posted", { rev: 2 })),
    [`POST /${TX_POSTED}/cancel`]: () => act(detail(TX_POSTED, "cancelled")),
    [`PATCH /${TX_POSTED}/describe`]: () => [200, detail(TX_POSTED, "posted", { holder: "Kho A" })],
    [`GET /${TX_DRAFT}`]: () => [200, detail(TX_DRAFT, "draft")],
    [`GET /${TX_POSTED}`]: () => [200, detail(TX_POSTED, "posted")],
    [`DELETE /${TX_DRAFT}`]: () => [204, null],
  };
  return table[`${method} ${path}`]?.() ?? [404, { error: { code: "NOT_FOUND", message: "x" } }];
}

const bodyOf = (r: Route): unknown => {
  try {
    return r.request().postDataJSON();
  } catch {
    return null;
  }
};

/** Backend giả Giao dịch: danh sách (ghi lại query), chi tiết nháp/đã ghi sổ, và mọi thao tác ghi (ghi lại thân). */
async function installTx(page: Page, o: Opts = {}): Promise<{ sent: Sent[]; queries: string[] }> {
  const sent = await installV2f(page);
  const queries: string[] = [];
  await page.route("**/pack/contracts/transactions**", (r) => {
    const method = r.request().method();
    const u = new URL(r.request().url());
    const path = u.pathname.replace("/pack/contracts/transactions", "");
    if (method !== "GET") sent.push({ method, path: u.pathname, body: bodyOf(r) });
    if (method === "GET" && path === "") queries.push(u.search);
    const [status, body] = reply(method, path, u, o) ?? [404, null];
    return status === 204 ? r.fulfill({ status }) : json(r, status, body);
  });
  return { sent, queries };
}

test("menu có mục Giao dịch cạnh Hợp đồng; danh sách hiện hàng + nhãn trạng thái", async ({
  page,
}) => {
  await installTx(page);
  await page.goto("/transactions");
  await expect(page.getByRole("link", { name: "Giao dịch" }).first()).toBeVisible();
  const rows = page.getByTestId("tx-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Công ty An Phát");
  await expect(rows.nth(0)).toContainText("Nháp");
  await expect(rows.nth(1)).toContainText("Đã ghi sổ");
  await expect(rows.nth(1)).toContainText("Mua");
});

test("lọc trạng thái + loại gửi đúng query lên máy chủ", async ({ page }) => {
  const { queries } = await installTx(page);
  await page.goto("/transactions");
  await expect(page.getByTestId("tx-row")).toHaveCount(2);
  await page.getByLabel("Trạng thái").selectOption("draft");
  await page.getByLabel("Loại", { exact: true }).selectOption("buy");
  await expect.poll(() => queries.at(-1) ?? "").toContain("status=draft");
  expect(queries.at(-1)).toContain("deal=buy");
  expect(queries.at(-1)).toContain("page=1");
});

test("tạo nháp: chọn SP, nhập SL/đơn giá ⇒ POST đúng thân, mở chi tiết nháp", async ({ page }) => {
  const { sent } = await installTx(page);
  await page.goto("/transactions/new");
  await page.getByLabel("Đối tác", { exact: true }).fill("Công ty An Phát");
  await page.getByLabel("Sản phẩm dòng 1").selectOption(P_TOKEN.id);
  await expect(page.getByLabel("Tên dòng 1")).toHaveValue("USB Token");
  await page.getByLabel("Số lượng dòng 1").fill("3");
  await page.getByLabel("Đơn giá dòng 1").fill("500.000");
  await expect(page.getByTestId("tx-amount-0")).toHaveText("1.500.000");
  await page.getByTestId("tx-save").click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${TX_DRAFT}$`));
  const post = sent.find((s) => s.method === "POST" && s.path.endsWith("/transactions"));
  expect(post?.body).toMatchObject({
    deal: "sell",
    partner_name: "Công ty An Phát",
    lines: [{ name: "USB Token", qty: "3", unit_price: 500000, product_id: P_TOKEN.id }],
  });
});

test("form thiếu đối tác ⇒ báo lỗi, không gọi máy chủ", async ({ page }) => {
  const { sent } = await installTx(page);
  await page.goto("/transactions/new");
  await page.getByTestId("tx-save").click();
  await expect(page.getByTestId("tx-form-error")).toHaveText("Nhập tên đối tác.");
  expect(sent.some((s) => s.path.endsWith("/transactions"))).toBe(false);
});

test("ghi sổ nháp: xác nhận ⇒ hộp kho trước → sau theo dữ liệu máy chủ", async ({ page }) => {
  const { sent } = await installTx(page);
  await page.goto(`/transactions/${TX_DRAFT}`);
  await page.getByTestId("tx-post").click();
  await page.getByRole("button", { name: "Ghi sổ", exact: true }).last().click();
  const table = page.getByTestId("stock-table");
  await expect(table).toContainText("USB Token");
  await expect(table).toContainText("10");
  await expect(table).toContainText("7");
  expect(sent.some((s) => s.path.endsWith(`/${TX_DRAFT}/post`))).toBe(true);
});

test("ghi sổ lỗi TRANSACTION_STOCK ⇒ hiện thông điệp máy chủ, nháp giữ nguyên", async ({
  page,
}) => {
  await installTx(page, { postError: true });
  await page.goto(`/transactions/${TX_DRAFT}`);
  await page.getByTestId("tx-post").click();
  await page.getByRole("button", { name: "Ghi sổ", exact: true }).last().click();
  await expect(page.getByTestId("tx-form-error")).toHaveText(
    "Kho USB Token không đủ: cần 3, còn 2",
  );
  await expect(page.getByTestId("tx-post")).toBeVisible();
});

test("giao dịch đã ghi sổ: nghĩa vụ, dòng thời gian, mô tả sửa trực tiếp", async ({ page }) => {
  const { sent } = await installTx(page);
  await page.goto(`/transactions/${TX_POSTED}`);
  await expect(page.getByTestId("tx-obligations")).toContainText("Thu");
  await expect(page.getByTestId("tx-event")).toHaveCount(2);
  await page.getByLabel("Người giữ").fill("Kho A");
  await page.getByTestId("tx-describe-save").click();
  const body = sent.find((s) => s.path.endsWith("/describe"))?.body;
  expect(body).toMatchObject({ holder: "Kho A" });
});

test("điều chỉnh và huỷ cần lý do (≥ 3 ký tự) rồi hiện kho đã đảo", async ({ page }) => {
  const { sent } = await installTx(page);
  await page.goto(`/transactions/${TX_POSTED}`);
  await page.getByTestId("tx-adjust").click();
  const submit = page.getByTestId("tx-adjust-submit");
  await expect(submit).toBeDisabled();
  await page.getByLabel(/^Lý do/).fill("Sai số lượng");
  await page.getByLabel("Số lượng dòng 1").fill("2");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId("stock-table")).toBeVisible();
  const adj = sent.find((s) => s.path.endsWith("/adjust"))?.body as {
    reason: string;
    lines: { qty: string }[];
  };
  expect(adj.reason).toBe("Sai số lượng");
  expect(adj.lines[0]?.qty).toBe("2");
  await page.getByRole("button", { name: "Đóng" }).click();

  await page.getByTestId("tx-cancel").click();
  const go = page.getByTestId("tx-cancel-submit");
  await expect(go).toBeDisabled();
  await page.getByLabel(/^Lý do/).fill("Khách huỷ đơn");
  await go.click();
  expect(sent.find((s) => s.path.endsWith("/cancel"))?.body).toEqual({ reason: "Khách huỷ đơn" });
});

test("trang HĐ: khối Giao dịch liên kết + link sang danh sách đã lọc theo HĐ", async ({ page }) => {
  const { queries } = await installTx(page, { linked: true });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  const block = page.getByTestId("contract-tx-block");
  await expect(block).toContainText("Giao dịch liên kết");
  await page.getByTestId("contract-tx-all").click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?contract=${ACTIVE_ID}`));
  await expect.poll(() => queries.at(-1) ?? "").toContain(`contract_id=${ACTIVE_ID}`);
});

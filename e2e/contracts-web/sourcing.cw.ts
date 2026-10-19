// W1 · "Mua hàng" (/sourcing) · Luật 4b: 4 ô số, bảng hàng đang bán (nguồn, lãi, rủi ro), đổi nguồn ⇒ PUT đúng thân, lỗi 422, người xem
// không có ô chọn, lọc rủi ro, bảng nhà cung cấp. Backend giả `page.route`. Màn gốc ở cm-web (Next), không phải web mgmt-app dùng cho
// so ảnh ⇒ không có cảnh so ảnh (DEVIATIONS.md).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Sent = { method: string; path: string; body: unknown };
const S1 = "51000000-0000-4000-8000-000000000001";
const M1 = "a1000000-0000-4000-8000-000000000001";
const M2 = "a1000000-0000-4000-8000-000000000002";
const ref = (
  id: string,
  number: string,
  supplier: string,
  price: number,
  o: Record<string, unknown> = {},
) => ({
  contract_id: id,
  number,
  line: 0,
  supplier: { key: `k-${number}`, name: supplier },
  price,
  unit: "ram",
  current: true,
  status: "active",
  end_date: "2027-01-01",
  ...o,
});
const line = (o: Record<string, unknown>) => ({
  product: "name:giay a4|",
  name: "Giấy A4",
  code: null,
  unit: "ram",
  qty: 10,
  price: 80_000,
  contract_id: S1,
  number: "S-1",
  line: 0,
  kind: "contract",
  end_date: null,
  customer: { key: "tax:9", name: "Khách An" },
  source: { ...ref(M1, "M-1", "NCC Một", 50_000), mode: "auto" },
  margin: 30_000,
  margin_pct: 37.5,
  profit: 300_000,
  risk: null,
  ...o,
});
type Line = Record<string, unknown>;
const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
/** Máy chủ giả: tìm bỏ dấu, lọc rủi ro, cắt trang như `GET /sourcing`. */
const data = (lines: Line[], url = "http://x/?") => {
  const q = new URL(url).searchParams;
  const size = Number(q.get("page_size") ?? 50);
  const page = Number(q.get("page") ?? 1);
  const hit = lines.filter(
    (l) =>
      (q.get("risk") !== "1" || l.risk) &&
      (!q.get("q") ||
        fold(`${l.name} ${l.number} ${(l.customer as { name: string }).name}`).includes(
          fold(q.get("q")),
        )),
  );
  return {
    stats: {
      lines: lines.length,
      profit: lines.reduce((s, l) => s + Number(l.profit ?? 0), 0),
      sourced: lines.filter((l) => l.source).length,
      at_risk: lines.filter((l) => l.risk).length,
    },
    total: hit.length,
    page,
    page_size: size,
    lines: hit.slice((page - 1) * size, page * size),
    candidates: {
      "name:giay a4|": [ref(M1, "M-1", "NCC Một", 50_000), ref(M2, "M-2", "NCC Hai", 60_000)],
    },
    suppliers: lines.length
      ? [
          {
            supplier: { key: "k-M-1", name: "NCC Một" },
            lines: 1,
            customers: ["Khách An"],
            at_risk: 1,
            profit: 300_000,
          },
        ]
      : [],
    truncated: false,
  };
};
const RISKY = line({
  name: "Bút",
  product: "name:but|",
  line: 1,
  number: "S-2",
  source: { ...ref(M2, "M-2", "NCC Hai", 60_000, { status: "expiring" }), mode: "auto" },
  risk: "source_expiring",
});

async function install(page: Page, role: Role, init: Line[] = [RISKY, line({})]) {
  const sent: Sent[] = [];
  const d = asHub(role);
  let current = init;
  const json = (r: Route, code: number, b: unknown) =>
    r.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(b) });
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
  await page.route(/\/pack\/contracts\/sourcing(\?.*)?$/, (r) =>
    json(r, 200, data(current, r.request().url())),
  );
  await page.route("**/pack/contracts/sourcing/*/*", (r) => {
    const req = r.request();
    const b = req.postDataJSON() as { contract_id: string | null };
    sent.push({ method: req.method(), path: new URL(req.url()).pathname, body: b });
    if (b.contract_id === "bad")
      return json(r, 422, { error: { code: "SOURCING_INVALID", message: "x" } });
    current = [
      RISKY,
      line({
        source: { ...ref(M2, "M-2", "NCC Hai", 60_000), mode: "chosen" },
        margin: 20_000,
        profit: 200_000,
      }),
    ];
    return json(r, 200, { ok: true });
  });
  return sent;
}

test("4 ô số, bảng dòng bán: nguồn, lãi, rủi ro xếp trước; bảng nhà cung cấp", async ({ page }) => {
  await install(page, "editor");
  await page.goto("/sourcing");
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Mua hàng", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("sale-line")).toHaveCount(2);
  await expect(page.getByTestId("sale-line").first()).toContainText("Nguồn sắp hết hạn");
  const a4 = page.getByTestId("sale-line").filter({ hasText: "Giấy A4" });
  await expect(a4).toContainText("NCC Một");
  await expect(a4).toContainText("30.000");
  await expect(a4).toContainText("37.5%");
  await expect(page.getByTestId("supplier-row")).toContainText("1 dòng");
});

test("đổi nguồn ⇒ PUT /sourcing/:hđ/:dòng đúng thân rồi tải lại; chọn «Tự chọn» ⇒ contract_id null", async ({
  page,
}) => {
  const sent = await install(page, "editor");
  await page.goto("/sourcing");
  const sel = page.getByLabel("Nguồn của Giấy A4");
  await sel.selectOption(`${M2}#0`);
  await expect(page.getByTestId("sale-line").filter({ hasText: "Giấy A4" })).toContainText(
    "20.000",
  );
  expect(sent).toEqual([
    { method: "PUT", path: `/pack/contracts/sourcing/${S1}/0`, body: { contract_id: M2, line: 0 } },
  ]);
  await sel.selectOption("");
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.body).toEqual({ contract_id: null });
});

test("người xem: không có ô chọn nguồn", async ({ page }) => {
  await install(page, "viewer");
  await page.goto("/sourcing");
  await expect(page.getByTestId("sale-line")).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: /Nguồn của/ })).toHaveCount(0);
});

test("chỉ dòng có rủi ro; ô tìm; rỗng", async ({ page }) => {
  await install(page, "editor");
  await page.goto("/sourcing");
  await page.getByLabel("Chỉ dòng có rủi ro").check();
  await expect(page.getByTestId("sale-line")).toHaveCount(1);
  await page.getByLabel("Chỉ dòng có rủi ro").uncheck();
  await page.getByRole("searchbox").fill("khach an");
  await expect(page.getByTestId("sale-line")).toHaveCount(2);
  await page.getByRole("searchbox").fill("khong-co-gi");
  await expect(page.getByTestId("sale-line")).toHaveCount(0);
});

test("chưa có hợp đồng bán ⇒ thông báo rỗng", async ({ page }) => {
  await install(page, "editor", []);
  await page.goto("/sourcing");
  await expect(page.getByText("Chưa có hợp đồng bán có bảng giá")).toBeVisible();
});

test("phân trang ở máy chủ: 25 dòng, 20/trang ⇒ trang 2 còn 5 dòng; ô tìm gửi q lên máy chủ", async ({
  page,
}) => {
  const lines = Array.from({ length: 25 }, (_, i) =>
    line({
      number: `S-${String(i).padStart(2, "0")}`,
      line: i,
      name: i === 7 ? "Mực in" : "Giấy A4",
    }),
  );
  await install(page, "editor", lines);
  await page.goto("/sourcing");
  await expect(page.getByTestId("sale-line")).toHaveCount(20);
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("sale-line")).toHaveCount(5);
  await page.getByRole("searchbox").fill("muc in");
  await expect(page.getByTestId("sale-line")).toHaveCount(1);
});

test("trang chi tiết HĐ bán đã duyệt: thẻ «Nguồn hàng & lãi» (gọi ?contract=); HĐ chưa duyệt ⇒ không thẻ", async ({
  page,
}) => {
  const sent: string[] = [];
  await install(page, "editor", [line({ contract_id: contract.id })]);
  await page.route("**/pack/contracts/contracts/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...contractAsHub(), status: "active", direction: "sale" }),
    }),
  );
  page.on("request", (q) => {
    if (q.url().includes("/pack/contracts/sourcing?"))
      sent.push(new URL(q.url()).searchParams.get("contract") ?? "");
  });
  await page.goto(`/contracts/${contract.id}`);
  const card = page.getByTestId("contract-sourcing");
  await expect(card).toContainText("Nguồn hàng & lãi");
  await expect(page.getByTestId("sale-line")).toHaveCount(1);
  expect(sent).toContain(contract.id);
});

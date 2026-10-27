// DOC-ui-list · Luật 4b: danh sách "Hợp đồng & giao dịch" — 3 loại chứng từ, HĐ nguyên tắc lồng con (nest), lọc loại kèm số, menu 4 mục,
// `/transactions` chuyển hướng sang danh sách lọc Giao dịch. Backend giả `page.route`; không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { listAsHub, ROWS } from "./dataset-list";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const base = listAsHub().items;
const FRAME = base[0];
const ECON = base[1];
const DEAL = base[2];
const CHILD_ID = "c1000000-0000-4000-8000-0000000000c1";
const COUNTS: Record<string, number> = { framework: 1, contract: 4, deal: 7 };

const doc = (id: string | undefined, doc_type: string) => ({
  id,
  doc_type,
  frame_root_id: null,
  frame_restricted: false,
});
const child = {
  frame_root_id: FRAME?.id,
  id: CHILD_ID,
  doc_type: "deal",
  title: "Giao dịch lô 1",
  number: "GD-001",
  status: "active",
  value: 12_000_000,
};

/** Trả lời `GET /contracts` theo tham số: truy vấn đếm (`page_size=1`) ⇒ chỉ `total`; còn lại ⇒ 3 loại + con (khi `nest=1`). */
async function installList(page: Page): Promise<URLSearchParams[]> {
  const reqs: URLSearchParams[] = [];
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r: Route) => {
      const q = new URL(r.request().url()).searchParams;
      reqs.push(q);
      const types = q.getAll("doc_type");
      const only = types.length === 1 ? types[0] : null;
      const body =
        q.get("page_size") === "1"
          ? { ...listAsHub(), items: [], total: COUNTS[only ?? ""] ?? 0, page_size: 1 }
          : only === "deal"
            ? {
                ...listAsHub(),
                items: [DEAL],
                total: 1,
                docs: [doc(DEAL?.id, "deal")],
                children: [],
              }
            : {
                ...listAsHub(),
                items: [FRAME, ECON, DEAL],
                total: 3,
                docs: [
                  doc(FRAME?.id, "framework"),
                  doc(ECON?.id, "contract"),
                  doc(DEAL?.id, "deal"),
                ],
                children: q.get("nest") === "1" ? [child] : [],
              };
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    },
  );
  return reqs;
}

test("mặc định: nest=1, 3 loại có nhãn, con thụt ngay dưới HĐ nguyên tắc", async ({ page }) => {
  await installV2f(page);
  const reqs = await installList(page);
  await page.goto("/contracts");
  const rows = page.locator("main tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(FRAME?.title ?? "");
  await expect(rows.nth(0)).toContainText("HĐ nguyên tắc");
  await expect(rows.nth(1)).toHaveAttribute("data-testid", "child-row");
  await expect(rows.nth(1)).toContainText("Giao dịch lô 1");
  await expect(rows.nth(1)).toContainText("GD-001");
  await expect(rows.nth(2)).toContainText(ECON?.title ?? "");
  await expect(rows.nth(3)).toContainText("Giao dịch");
  const main = reqs.find((q) => q.get("page_size") === "20");
  expect(main?.get("nest")).toBe("1");
  expect(main?.get("include")).toBe("progress");
  expect(ROWS.length).toBeGreaterThan(2);
});

test("bộ lọc loại hiện số mỗi loại; chọn Giao dịch ⇒ doc_type=deal, không nest, URL ?type=deal", async ({
  page,
}) => {
  await installV2f(page);
  const reqs = await installList(page);
  await page.goto("/contracts");
  const bar = page.getByTestId("doc-type-filter");
  await expect(bar.getByRole("radio", { name: /^Tất cả\s*12$/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(bar.getByRole("radio", { name: /^HĐ nguyên tắc\s*1$/ })).toBeVisible();
  await expect(bar.getByRole("radio", { name: /^HĐ kinh tế\s*4$/ })).toBeVisible();
  await bar.getByRole("radio", { name: /^Giao dịch\s*7$/ }).click();
  await expect(page).toHaveURL(/\/contracts\?type=deal/);
  await expect(page.locator("main tbody tr")).toHaveCount(1);
  const last = reqs.filter((q) => q.get("page_size") === "20").at(-1);
  expect(last?.getAll("doc_type")).toEqual(["deal"]);
  expect(last?.has("nest")).toBe(false);
});

test("mở thẳng ?type=framework ⇒ chọn sẵn bộ lọc, gửi doc_type=framework + nest=1", async ({
  page,
}) => {
  await installV2f(page);
  const reqs = await installList(page);
  await page.goto("/contracts?type=framework");
  await expect(
    page.getByTestId("doc-type-filter").getByRole("radio", { name: /^HĐ nguyên tắc/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => reqs.some((q) => q.get("page_size") === "20")).toBe(true);
  const main = reqs.find((q) => q.get("page_size") === "20");
  expect(main?.getAll("doc_type")).toEqual(["framework"]);
  expect(main?.get("nest")).toBe("1");
});

test("nút «Thêm giao dịch» mở form Giao dịch; menu còn 4 mục", async ({ page }) => {
  await installV2f(page);
  await installList(page);
  await page.goto("/contracts");
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Hợp đồng & giao dịch" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Giao dịch$/ })).toHaveCount(0);
  await page.getByTestId("add-deal").click();
  await expect(page).toHaveURL(/\/contracts\/new\?type=deal/);
  await expect(page.getByLabel(/^Tên giao dịch/)).toBeVisible();
});

test("/transactions chuyển hướng sang danh sách lọc Giao dịch", async ({ page }) => {
  await installV2f(page);
  await installList(page);
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/contracts\?type=deal/);
  await expect(
    page.getByTestId("doc-type-filter").getByRole("radio", { name: /^Giao dịch/ }),
  ).toHaveAttribute("aria-checked", "true");
});

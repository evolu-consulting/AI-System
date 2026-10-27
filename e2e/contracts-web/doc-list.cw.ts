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

/** HĐ NT ở phiên bản 2: `id` ≠ `root_id`; con gắn theo `root_id` (DOC-ui-gaps). */
const FRAME_ROOT = "c1000000-0000-4000-8000-0000000000f0";
const doc = (id: string | undefined, doc_type: string) => ({
  id,
  doc_type,
  frame_root_id: null,
  root_id: doc_type === "framework" ? FRAME_ROOT : id,
  source: doc_type === "deal" ? "invoice" : null,
  frame_restricted: false,
});
const child = {
  frame_root_id: FRAME_ROOT,
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

test("HĐ NT phiên bản 2 (id ≠ root_id): con vẫn thụt dưới cha, không bị đẩy xuống cuối", async ({
  page,
}) => {
  await installV2f(page);
  await installList(page);
  await page.goto("/contracts");
  await expect(page.getByTestId("child-row")).toHaveCount(1);
  await expect(page.getByTestId("child-orphan")).toHaveCount(0);
});

test("cột «Nguồn» chỉ hiện khi lọc Giao dịch; hiện tên nguồn từ docs.source", async ({ page }) => {
  await installV2f(page);
  await installList(page);
  await page.goto("/contracts");
  await expect(page.locator("main thead th", { hasText: "Nguồn" })).toHaveCount(0);
  await page.goto("/contracts?type=deal");
  await expect(page.locator("main thead th", { hasText: "Nguồn" })).toHaveCount(1);
  await expect(page.getByTestId("source-cell")).toHaveText("Hoá đơn");
});

async function postedForm(page: Page, pick: () => Promise<void>): Promise<string> {
  await installV2f(page);
  await installList(page);
  let body = "";
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      body = r.request().postData() ?? "";
      return r.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: CHILD_ID, status: "extracting", version: 1 }),
      });
    },
  );
  await page.goto("/contracts");
  await page
    .locator(`input[type="file"]`)
    .setInputFiles([
      { name: "hd.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 x") },
    ]);
  await pick();
  await page.getByTestId("upload-confirm").click();
  await expect.poll(() => body).not.toBe("");
  return body;
}

test("tải lên chọn HĐ nguyên tắc: gửi doc_type + hạn mức + cách đặt hàng (số kiểu Việt)", async ({
  page,
}) => {
  const body = await postedForm(page, async () => {
    const dlg = page.getByRole("dialog", { name: "Tải lên chứng từ" });
    await dlg.getByRole("radio", { name: /Hợp đồng nguyên tắc/ }).check();
    await dlg.getByLabel(/^Hạn mức công nợ/).fill("400.000.000");
    await dlg.getByLabel(/^Cách đặt hàng/).fill("Đặt qua email");
  });
  expect(body).toContain(`name="doc_type"\r\n\r\nframework`);
  expect(body).toContain(`name="credit_limit"\r\n\r\n400000000`);
  expect(body).toContain(`name="order_terms"\r\n\r\nĐặt qua email`);
  expect(body).not.toContain("frame_root_id");
});

test("tải lên HĐ kinh tế thuộc HĐ nguyên tắc: gửi frame_root_id; mặc định chỉ doc_type=contract", async ({
  page,
}) => {
  const body = await postedForm(page, async () => {
    const dlg = page.getByRole("dialog", { name: "Tải lên chứng từ" });
    await dlg.getByTestId("frame-options").getByRole("button").first().click();
  });
  expect(body).toContain(`name="doc_type"\r\n\r\ncontract`);
  expect(body).toContain(`name="frame_root_id"\r\n\r\n${FRAME?.id}`);
});

test("tải lên: hạn mức không phải số ⇒ báo lỗi, không gửi; Huỷ ⇒ đóng hộp", async ({ page }) => {
  await installV2f(page);
  await installList(page);
  let posted = false;
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      if (r.request().method() === "POST") posted = true;
      return r.fallback();
    },
  );
  await page.goto("/contracts");
  await page
    .locator(`input[type="file"]`)
    .setInputFiles([
      { name: "hd.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 x") },
    ]);
  const dlg = page.getByRole("dialog", { name: "Tải lên chứng từ" });
  await dlg.getByRole("radio", { name: /Hợp đồng nguyên tắc/ }).check();
  await dlg.getByLabel(/^Hạn mức công nợ/).fill("abc");
  await dlg.getByTestId("upload-confirm").click();
  await expect(dlg.getByRole("alert")).toContainText("Hạn mức không đọc được");
  expect(posted).toBe(false);
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await expect(dlg).toBeHidden();
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

// Gap #8/#9/#10 · danh sách HĐ: lọc ngày (trạng thái trên URL ⇒ truy vấn server), xuất Excel/CSV theo đúng bộ lọc, tải lên nhiều tệp
// (mỗi tệp một lượt, tiến độ/lỗi từng tệp, nhận .md). Backend giả `page.route` như `hd5-list.cw.ts`; chờ yêu cầu/phần tử, không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub } from "./dataset-list";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const LIST = (u: URL) => u.pathname === "/pack/contracts/contracts";
const EXPORT = (u: URL) => u.pathname === "/pack/contracts/contracts/export";

async function install(page: Page) {
  const d = asHub("editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  const at = (n: string) => (u: URL) => u.pathname === `/pack/contracts/${n}`;
  await page.route(at("contracts/facets"), (r) => json(r, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, membersAsHub()));
}

test.describe("Gap #10 · lọc ngày", () => {
  test("chọn 'Quá hạn' ⇒ URL có due=overdue và truy vấn có due; tải lại giữ nguyên; chọn khoảng ⇒ date_from/date_to", async ({
    page,
  }) => {
    await install(page);
    const queries: URLSearchParams[] = [];
    await page.route(LIST, (r) => {
      queries.push(new URL(r.request().url()).searchParams);
      return json(r, listAsHub());
    });
    await page.goto("/contracts");
    await page.getByLabel("Cột ngày").selectOption("action_deadline");
    await page.getByLabel("Khoảng thời gian").selectOption("overdue");
    await expect.poll(() => queries.at(-1)?.get("due")).toBe("overdue");
    expect(queries.at(-1)?.get("date_field")).toBe("action_deadline");
    await expect(page).toHaveURL(/due=overdue/);
    await page.reload();
    await expect(page.getByLabel("Khoảng thời gian")).toHaveValue("overdue");
    await page.getByLabel("Khoảng thời gian").selectOption("range");
    await page.getByLabel("Từ ngày").fill("2026-01-01");
    await page.getByLabel("Đến ngày").fill("2026-03-31");
    await expect
      .poll(() => [queries.at(-1)?.get("date_from"), queries.at(-1)?.get("date_to")])
      .toEqual(["2026-01-01", "2026-03-31"]);
    expect(queries.at(-1)?.get("due")).toBeNull();
  });
});

test.describe("Gap #8 · xuất danh sách", () => {
  test("bấm 'Xuất Excel' ⇒ gọi /export với đúng bộ lọc (không page) và tải về tệp .xlsx", async ({
    page,
  }) => {
    await install(page);
    await page.route(LIST, (r) => json(r, listAsHub()));
    let seen: URLSearchParams | undefined;
    await page.route(EXPORT, (r) => {
      seen = new URL(r.request().url()).searchParams;
      return r.fulfill({
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="hop-dong-20261021.xlsx"',
          "x-export-total": "1",
          "x-export-truncated": "0",
        },
        body: Buffer.from("PK"),
      });
    });
    await page.goto("/contracts?due=30");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Xuất", exact: true }).click();
    await page.getByRole("menuitem", { name: "Xuất Excel" }).click();
    expect((await download).suggestedFilename()).toBe("hop-dong-20261021.xlsx");
    expect(seen?.get("format")).toBe("xlsx");
    expect(seen?.get("due")).toBe("30");
    expect(seen?.has("page")).toBe(false);
    expect(seen?.has("page_size")).toBe(false);
  });
});

test.describe("Gap #9 · tải lên nhiều tệp", () => {
  test("chọn 3 tệp (pdf, .md, .exe) ⇒ 2 lượt POST riêng, tệp .exe báo lỗi ngay, bảng hiện trạng thái từng tệp", async ({
    page,
  }) => {
    await install(page);
    await page.route(LIST, (r) => json(r, listAsHub()));
    const posted: string[] = [];
    await page.route(
      (u) => u.pathname === "/pack/contracts/contracts",
      async (r) => {
        if (r.request().method() !== "POST") return r.fallback();
        posted.push(r.request().postData()?.includes("hd.md") ? "md" : "pdf");
        return json(
          r,
          {
            id: `c2000000-0000-4000-8000-00000000000${posted.length}`,
            status: "extracting",
            version: 1,
          },
          201,
        );
      },
    );
    await page.goto("/contracts");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "hd.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 x") },
      { name: "hd.md", mimeType: "text/markdown", buffer: Buffer.from("# Điều 1") },
      { name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
    ]);
    const panel = page.getByRole("region", { name: "Tải lên hợp đồng" });
    await expect(panel.getByText("Chỉ nhận PDF, DOCX, PNG, JPG hoặc Markdown")).toBeVisible();
    await expect(panel.locator('li[data-state="done"]')).toHaveCount(2);
    expect(posted).toEqual(["pdf", "md"]);
    await expect(page).toHaveURL(/\/contracts$/); // nhiều tệp ⇒ ở lại danh sách
  });

  test("hết lượt (429 UPLOAD_QUOTA) ⇒ popup một lần, dừng hàng đợi: không POST tệp sau, mọi tệp lỗi không có Thử lại", async ({
    page,
  }) => {
    await install(page);
    await page.route(LIST, (r) => json(r, listAsHub()));
    let n = 0;
    await page.route(
      (u) => u.pathname === "/pack/contracts/contracts",
      async (r) => {
        if (r.request().method() !== "POST") return r.fallback();
        n++;
        return json(
          r,
          {
            error: {
              code: "UPLOAD_QUOTA",
              message: "quota",
              details: { scope: "tenant", limit: 20, resets_at: "2026-10-28T00:00:00Z" },
            },
          },
          429,
        );
      },
    );
    await page.goto("/contracts");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 a") },
      { name: "b.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 b") },
    ]);
    const panel = page.getByRole("region", { name: "Tải lên hợp đồng" });
    const dialog = page.getByRole("dialog", { name: "Đã hết lượt tải hợp đồng hôm nay" });
    await expect(dialog).toContainText("Công ty đã dùng hết 20 lượt tải lên trong ngày");
    await dialog.getByRole("button", { name: "Đã hiểu" }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.locator('li[data-state="error"]')).toHaveCount(2);
    await expect(panel.getByRole("button", { name: "Thử lại" })).toHaveCount(0);
    expect(n).toBe(1);
  });
});

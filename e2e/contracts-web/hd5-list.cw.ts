// HD-FR-51 · HD-FR-54 · HD-FR-55 · S03/S05: hành vi danh sách (lọc/tìm gửi đúng truy vấn server, phụ lục hiện "Phụ lục của …")
// và khối "Phụ lục và giá" trên S05. Backend giả `page.route` (dữ liệu `dataset-list.ts`); chờ phần tử/yêu cầu, không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, dataset } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub, ROWS } from "./dataset-list";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function install(page: Page, role: "editor" | "viewer" = "editor") {
  const d = asHub(role);
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

test.describe("HD-FR-51 · danh sách phía server", () => {
  test("chọn lọc Trạng thái ⇒ truy vấn có status=…; tìm chữ ⇒ q=…; về trang 1", async ({
    page,
  }) => {
    await install(page);
    const queries: URLSearchParams[] = [];
    await page.route(
      (u) => u.pathname === "/pack/contracts/contracts",
      (r) => {
        queries.push(new URL(r.request().url()).searchParams);
        return json(r, listAsHub());
      },
    );
    await page.goto("/contracts");
    await expect(page.getByText("Hợp đồng cung cấp gia vị").first()).toBeVisible();
    expect(queries[0]?.get("page")).toBe("1");
    await page.getByRole("button", { name: "Lọc", exact: true }).click();
    await page.getByRole("button", { name: /^Trạng thái/ }).click();
    await page.getByRole("checkbox", { name: "Chờ xác nhận" }).check();
    await expect.poll(() => queries.at(-1)?.getAll("status")).toEqual(["needs_review"]);
    await page.getByRole("searchbox").fill("gia vị");
    await expect.poll(() => queries.at(-1)?.get("q")).toBe("gia vị");
    expect(queries.at(-1)?.getAll("status")).toEqual(["needs_review"]);
  });

  test("hàng phụ lục hiện 'Phụ lục của <HĐ gốc>'; viewer không có nút thêm", async ({ page }) => {
    await install(page, "viewer");
    const parent = ROWS[0];
    const data = listAsHub([
      {
        id: "c1000000-0000-4000-8000-000000000099",
        kind: "appendix",
        parent_id: parent?.id,
        title: "Phụ lục 01 giá bao bì",
        number: "PL01",
      },
    ]);
    await page.route(
      (u) => u.pathname === "/pack/contracts/contracts",
      (r) =>
        json(r, {
          ...data,
          parents: [{ id: parent?.id, title: parent?.title, number: parent?.number }],
        }),
    );
    await page.goto("/contracts");
    await expect(
      page.getByText("PL01 · Phụ lục của Hợp đồng mua bán bao bì 2026").first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload hợp đồng" })).toHaveCount(0);
  });
});

test.describe("HD-FR-54/55 · S05 khối phụ lục", () => {
  test("HĐ gốc liệt kê phụ lục + bảng giá đã áp (giá cũ mờ, ghi 'đã bị thay')", async ({
    page,
  }) => {
    await install(page);
    const detail = {
      ...contractAsHub(),
      status: "active",
      appendices: [
        {
          id: "c1000000-0000-4000-8000-000000000098",
          title: "Phụ lục 01",
          number: "PL01",
          status: "active",
          effective_date: "2026-07-01",
        },
      ],
    };
    await page.route(`**/pack/contracts/contracts/${contract.id}`, (r) => json(r, detail));
    await page.route(`**/pack/contracts/contracts/${contract.id}/prices`, (r) =>
      json(r, {
        as_of: "2026-10-18",
        total: 2,
        lines: [
          {
            item: {
              code: null,
              name: "Màng co PE",
              spec: null,
              unit: "cuộn",
              qty: 500,
              unit_price: 320000,
              vat_rate: null,
            },
            source: { id: contract.id, kind: "contract", title: detail.title },
            valid_from: null,
            valid_to: "2026-06-30",
            superseded_by: "c1000000-0000-4000-8000-000000000098",
            current: false,
          },
          {
            item: {
              code: null,
              name: "Màng co PE",
              spec: null,
              unit: "cuộn",
              qty: 500,
              unit_price: 350000,
              vat_rate: null,
            },
            source: {
              id: "c1000000-0000-4000-8000-000000000098",
              kind: "appendix",
              title: "Phụ lục 01",
            },
            valid_from: "2026-07-01",
            valid_to: null,
            superseded_by: null,
            current: true,
          },
        ],
      }),
    );
    await page.goto(`/contracts/${contract.id}`);
    const panel = page.locator("[data-hd5=appendix]");
    await expect(panel.getByRole("link", { name: "Phụ lục 01" }).first()).toBeVisible();
    await expect(panel.getByText("hiệu lực từ 01/07/2026")).toBeVisible();
    await expect(panel.getByText("350.000 đ")).toBeVisible();
    await expect(panel.getByText(/đã bị thay/)).toBeVisible();
  });

  test("HĐ chưa gắn: editor chọn gợi ý ⇒ PATCH parent với version hiện tại", async ({ page }) => {
    await install(page);
    await page.route(`**/pack/contracts/contracts/${contract.id}`, (r) => json(r, contractAsHub()));
    await page.route(`**/pack/contracts/contracts/${contract.id}/parent-suggestions`, (r) =>
      json(r, {
        items: [
          {
            id: "c1000000-0000-4000-8000-000000000077",
            title: "HĐ khung 2025",
            number: "K-01",
            seller: null,
            buyer: null,
            reason: "cited_number",
          },
        ],
      }),
    );
    let sent: unknown = null;
    await page.route(`**/pack/contracts/contracts/${contract.id}/parent`, (r) => {
      sent = r.request().postDataJSON();
      return json(r, {
        id: contract.id,
        kind: "appendix",
        parent_id: "c1000000-0000-4000-8000-000000000077",
        version: 4,
        updated_at: "2026-10-18T02:00:00.000Z",
      });
    });
    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("button", { name: /Gắn làm phụ lục/ }).click();
    await expect(page.getByText("văn bản nêu số hợp đồng này")).toBeVisible();
    await page.getByRole("button", { name: /HĐ khung 2025/ }).click();
    await expect
      .poll(() => sent)
      .toEqual({ version: 3, parent_id: "c1000000-0000-4000-8000-000000000077" });
  });
});

void dataset;

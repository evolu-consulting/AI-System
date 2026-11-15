// CR-152 · cr152b-kinds-ui · hành trình: HĐ Nhượng quyền (theo %) → Giám đốc duyệt → kế toán/người được giao «Ghi doanh thu kỳ…» thấy phí tính ra rồi lưu;
// HĐ Hợp tác «không chia» → chỉ có tóm tắt, KHÔNG có nút ghi đối soát. Dựng bằng API của gói (đổi loại + trường riêng khi HĐ còn nháp). Viết, chưa chạy.

import {
  apiAs,
  approveAs,
  envOf,
  expect,
  HUB,
  loginCw,
  newPage,
  SPEC_TENANT,
  submitContract,
  U,
} from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

async function packCall(
  s: { headers: Record<string, string> },
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const r = await fetch(`${HUB}/pack/contracts${path}`, {
    method,
    headers: { ...s.headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j05);

async function makeKind(
  browser: import("@playwright/test").Browser,
  run: string,
  deal: "franchise" | "cooperation",
  terms: Record<string, unknown>,
): Promise<string> {
  const s = await apiAs(E, U.employee);
  const id = await submitContract(browser, E, run, undefined, async (cid) => {
    const c = (await packCall(s, "GET", `/contracts/${cid}`)) as { version: number };
    await packCall(s, "POST", `/contracts/${cid}/review`, {
      version: c.version,
      deal,
      draft: true,
    });
    await packCall(s, "PUT", `/contracts/${cid}/kind-terms`, { terms });
  });
  await approveAs(await newPage(browser), E, U.director, id, "Giám đốc duyệt");
  await expect
    .poll(
      async () => ((await packCall(s, "GET", `/contracts/${id}`)) as { status?: string }).status,
      { timeout: 60_000 },
    )
    .toBe("done");
  return id;
}

let franchise = "";
let coop = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(400_000);
  franchise = await makeKind(browser, `nq-${Date.now().toString(36)}`, "franchise", {
    role: "franchisor",
    brand: "Cà Phê Mẫu",
    initial_fee: 300_000_000,
    fee_basis: "revenue_pct",
    fee_pct: 5,
    period: "month",
    foreign_franchisor: false,
  });
  coop = await makeKind(browser, `ht-${Date.now().toString(36)}`, "cooperation", {
    scope: "Cùng khai thác tuyến giao hàng",
    split_basis: "none",
  });
});

test("Nhượng quyền theo %: tóm tắt phí + ghi doanh thu kỳ thấy phí tính ra rồi lưu", async ({
  page,
}) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${franchise}`);
  await expect(page.getByTestId("kind-stats")).toContainText("300.000.000");
  await page.getByRole("button", { name: "Ghi doanh thu kỳ…" }).click();
  await page.getByLabel("Doanh thu (đồng)").fill("820000000");
  await expect(page.getByTestId("period-preview")).toContainText("41.000.000");
  await page.getByRole("button", { name: "Lưu và tạo mốc thu phí" }).click();
  await expect(page.getByTestId("kind-periods")).toContainText("820.000.000");
});

test("Hợp tác không chia: chỉ có ghi nhớ, không có nút ghi đối soát", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${coop}`);
  await expect(page.getByTestId("kind-stats")).toContainText("không chia tiền");
  await expect(page.getByRole("button", { name: "Ghi đối soát kỳ…" })).toHaveCount(0);
});

// V2-L · CD-01..06: hộp thoại Cài đặt mở từ avatar — 3 mục ở cột trái, đầu có Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt, chấm cam khi khác
// mặc định, đổi màu/tên áp ngay, lưu gửi đúng PUT; chủ sở hữu mới sửa được. Backend giả `page.route`; không sleep.
// Viết sẵn, CHƯA chạy (Luật 0b: e2e chạy một lần ở cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import type { Role } from "./dataset";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const P = "/pack/contracts";
const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const crit = (key: string, label: string, kind: string, weight: number, milestone?: string) => ({
  key,
  label,
  kind,
  ...(milestone ? { milestone } : {}),
  weight,
  enabled: true,
  custom: false,
});
const CELL = {
  criteria: [
    crit("on_time_delivery", "Giao đúng hạn", "ontime", 50, "delivery"),
    crit("quality", "Chất lượng", "jobs", 50),
  ],
  window_months: 12,
  decay: { months: [6, 12], factors: [1, 0.5, 0.2] },
  late_per_day: 2,
};
const KEYS = [
  "service:supplier",
  "service:customer",
  "goods:supplier",
  "goods:customer",
  "referral:commission_payer",
];
const CELLS = Object.fromEntries(KEYS.map((k) => [k, CELL]));
const SETTINGS = {
  good_from: 85,
  fair_from: 70,
  min_jobs: 3,
  manual_share: 20,
  reason_gap: 25,
  lock_period: "month",
};
const JOBS = [
  { key: "complaint", name: "Khiếu nại vô lý", criterion: "quality", score: 0, ord: 0 },
];
const BIZ = {
  w: { rot: 40, margin: 35, trend: 25 },
  buyDays: 45,
  dumpDays: 150,
  quotaBuy: 120,
  quotaDump: 70,
  hi: 70,
  lo: 45,
  vol: 6,
  soon: 60,
};
const CO = {
  name: "NITI GROUP",
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "light",
  own_names: [],
  own_tax_ids: [],
};

async function install(page: Page, role: Role) {
  const sent: Sent[] = await installV2f(page, { role });
  const body = (r: { request: () => { postDataJSON: () => unknown } }) =>
    r.request().postDataJSON();
  const rec = (m: string, path: string, b: unknown) => sent.push({ method: m, path, body: b });
  await page.route(`**${P}/company`, (r) => {
    if (r.request().method() === "PUT") {
      rec("PUT", `${P}/company`, body(r));
      return r.fulfill(
        json({
          company: CO,
          approval_enabled: true,
          defaults: { ...CO, name: null, theme: "auto", approval_enabled: true },
          version: 1,
          updated_at: null,
        }),
      );
    }
    return r.fulfill(
      json({
        company: CO,
        approval_enabled: true,
        defaults: { ...CO, name: null, theme: "auto", approval_enabled: true },
        version: 0,
        updated_at: null,
      }),
    );
  });
  await page.route(`**${P}/reputation/config`, (r) =>
    r.fulfill(
      json({
        cells: CELLS,
        settings: SETTINGS,
        job_types: JOBS,
        versions: {},
        defaults: { cells: CELLS, settings: SETTINGS, job_types: JOBS },
      }),
    ),
  );
  await page.route(`**${P}/reputation/config/cells/**`, (r) => {
    rec("PUT", new URL(r.request().url()).pathname, body(r));
    return r.fulfill(json({}));
  });
  await page.route(`**${P}/reputation/config/preview`, (r) =>
    r.fulfill(
      json({
        total: 3,
        changes: [
          {
            party: "tax:1",
            name: "Công ty A",
            role: "supplier",
            old: 80,
            new: 72,
            old_level: "fair",
            new_level: "fair",
          },
        ],
        sample: null,
      }),
    ),
  );
  await page.route(`**${P}/business/config`, (r) =>
    r.fulfill(json({ config: BIZ, defaults: BIZ, version: 0, updated_at: null })),
  );
  await page.route(`**${P}/business/config/preview`, (r) =>
    r.fulfill(json({ score: 74, suggestion: "dump", reason: "Tồn đủ bán 121 ngày", factors: [] })),
  );
  return sent;
}
const open = async (page: Page) => {
  await page.goto("/overview");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  return page.getByRole("dialog", { name: "Cài đặt" });
};

test("avatar → hộp thoại 3 mục; đầu có 3 nút; chưa đổi thì Lưu/Bỏ thay đổi bị khoá", async ({
  page,
}) => {
  await install(page, "owner");
  const dlg = await open(page);
  for (const n of ["Công ty", "Điểm uy tín", "Điểm kinh doanh"])
    await expect(dlg.getByRole("button", { name: new RegExp(n) }).first()).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Lưu cài đặt" })).toBeDisabled();
  await expect(dlg.getByRole("button", { name: "Bỏ thay đổi" })).toBeDisabled();
});

test("đổi màu chủ đạo: chấm cam ở mục Công ty, nút Lưu mở; Lưu gửi PUT /company với màu mới", async ({
  page,
}) => {
  const sent = await install(page, "owner");
  const dlg = await open(page);
  await dlg.getByRole("radio", { name: "Xanh ngọc" }).click();
  await expect(dlg.getByTestId("changed-dot").first()).toBeVisible();
  await expect
    .poll(() => page.locator("#brand-css").evaluate((el) => el.textContent))
    .toContain("#0d9488"); // <style>: toContainText bỏ qua nội dung style
  await dlg.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect
    .poll(() => sent.find((s) => s.path === `${P}/company`)?.body)
    .toMatchObject({ accent: "teal" });
});

test("điểm uy tín: 5 ô × 3 tab + Mức & đánh giá; đổi trọng số có thử tính", async ({ page }) => {
  const sent = await install(page, "owner");
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  for (const n of ["Nhà cung cấp", "Khách hàng", "Bên trả hoa hồng", "Mức & đánh giá"])
    await expect(dlg.getByRole("tab", { name: new RegExp(n) }).first()).toBeVisible();
  for (const n of ["Tiêu chí", "Thời gian", "Loại việc"])
    await expect(dlg.getByRole("tab", { name: n })).toBeVisible();
  await dlg.getByLabel("Trọng số Giao đúng hạn").fill("10");
  await expect(dlg.getByTestId("try-result")).toBeVisible();
  await expect(dlg.getByTestId("impact-count")).toBeVisible();
  await dlg.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect
    .poll(() => sent.find((s) => s.path.endsWith("/cells/service/supplier")))
    .toBeTruthy();
});

test("HD8-FR-03 (chuyển từ /settings/scoring): trọng số gửi lên tổng đúng 100; máy chủ 422 ⇒ hiện đúng câu, ô vẫn giữ nháp", async ({
  page,
}) => {
  const sent = await install(page, "owner");
  await page.route(`**${P}/reputation/config/cells/service/supplier`, (r) => {
    if (r.request().method() !== "PUT") return r.fallback();
    sent.push({
      method: "PUT",
      path: new URL(r.request().url()).pathname,
      body: r.request().postDataJSON(),
    });
    return r.fulfill(
      json({ error: { code: "SCORING_INVALID", message: "Mức Tốt phải cao hơn mức Khá" } }, 422),
    );
  });
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  await dlg.getByLabel("Trọng số Giao đúng hạn").fill("30");
  await dlg.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect(page.getByText("Mức Tốt phải cao hơn mức Khá")).toBeVisible();
  const put = sent.find((s) => s.path.endsWith("/cells/service/supplier"));
  const body = put?.body as { criteria: { key: string; weight: number }[] };
  expect(body.criteria.reduce((a, c) => a + c.weight, 0)).toBe(100);
  expect(body.criteria.map((c) => c.key)).toEqual(["on_time_delivery", "quality"]);
  await expect(dlg.getByRole("button", { name: "Lưu cài đặt" })).toBeEnabled();
});

test("điểm kinh doanh: thử tính hiện điểm + đề xuất từ API", async ({ page }) => {
  await install(page, "owner");
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm kinh doanh/ })
    .first()
    .click();
  await expect(dlg.getByTestId("try-result")).toContainText("74");
});

test("người không phải chủ sở hữu: xem được nhưng không có nút Lưu, ô khoá", async ({ page }) => {
  await install(page, "editor");
  const dlg = await open(page);
  await expect(dlg.getByText("Chỉ chủ sở hữu hợp đồng được sửa cài đặt")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Lưu cài đặt" })).toHaveCount(0);
  await expect(dlg.getByLabel("Tên công ty")).toBeDisabled();
});

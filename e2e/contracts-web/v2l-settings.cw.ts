// V2-L · U3 · CD-01..06: hộp thoại Cài đặt mở từ avatar — 3 mục ở cột trái, đầu có Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt, chấm cam khi khác
// mặc định, đổi màu/tên áp ngay, lưu gửi đúng PUT; chủ sở hữu mới sửa được. "Điểm uy tín" (CR-097a) = cách tính engine HD8 theo vai
// (`/scoring/:role`, lưu riêng, version + lịch sử). Backend giả `page.route`; không sleep.
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
const crit = (key: string, label: string, weight: number, enabled = true) => ({
  key,
  label,
  kind: "auto",
  enabled,
  weight,
});
const RULES = {
  good_from: 80,
  fair_from: 60,
  min_events: 3,
  window_months: 12,
  recency_boost: true,
  recency_months: 3,
  manual_adjust: true,
};
const scoringOf = (role: string, version = 4) => ({
  role,
  version,
  criteria: [crit("on_time", "Đúng hạn", 60), crit("reminders", "Ít phải nhắc", 40)],
  rules: RULES,
  updated_by: "Lan",
  updated_at: "2026-10-01T02:00:00Z",
  restorable: [],
  manual_choices: [],
});
const HISTORY = [{ version: 4, at: "2026-10-01T02:00:00Z", by: "Lan", summary: "Mức Tốt 85 → 80" }];
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
  await page.route(`**${P}/scoring/*/history`, (r) => r.fulfill(json(HISTORY)));
  await page.route(`**${P}/scoring/*/preview`, (r) => {
    rec("POST", new URL(r.request().url()).pathname, body(r));
    return r.fulfill(
      json({
        total: 3,
        changed_band: 1,
        changes: [
          {
            party: "tax:1",
            name: "Công ty A",
            old: 70,
            new: 58,
            band_old: "fair",
            band_new: "watch",
          },
        ],
      }),
    );
  });
  await page.route(`**${P}/scoring/customer`, (r) => {
    if (r.request().method() === "PUT") {
      rec("PUT", new URL(r.request().url()).pathname, body(r));
      return r.fulfill(json(scoringOf("customer", 5)));
    }
    return r.fulfill(json(scoringOf("customer")));
  });
  await page.route(`**${P}/scoring/supplier`, (r) => r.fulfill(json(scoringOf("supplier"))));
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

test("điểm uy tín: hai vai Khách hàng / Nhà cung cấp, phiên bản + lịch sử; đổi trọng số ⇒ xem trước N đối tác đổi mức", async ({
  page,
}) => {
  const sent = await install(page, "owner");
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  for (const n of ["Khách hàng", "Nhà cung cấp"])
    await expect(dlg.getByRole("radio", { name: n })).toBeVisible();
  await expect(dlg.getByText("Phiên bản 4").first()).toBeVisible();
  await expect(dlg.getByTestId("scoring-history")).toContainText("Mức Tốt 85 → 80");
  await expect(dlg.getByTestId("score-sum")).toContainText("100/100");
  await dlg.getByLabel("Trọng số Đúng hạn").fill("50");
  await expect(dlg.getByTestId("score-sum")).toContainText("90/100");
  await expect(dlg.getByRole("alert")).toContainText("đúng 100%");
  await expect(dlg.getByTestId("scoring-save")).toBeDisabled();
  await dlg.getByLabel("Trọng số Ít phải nhắc").fill("50");
  await expect(dlg.getByTestId("score-impact")).toContainText("1 đối tác đổi mức (trên 3)");
  await dlg.getByTestId("scoring-save").click();
  await expect
    .poll(() => sent.find((s) => s.method === "PUT" && s.path.endsWith("/scoring/customer"))?.body)
    .toMatchObject({
      criteria: [
        { key: "on_time", weight: 50, enabled: true },
        { key: "reminders", weight: 50, enabled: true },
      ],
      rules: { good_from: 80, fair_from: 60, min_events: 3 },
    });
  // Không còn ghi `/reputation/*` (410).
  expect(sent.some((s) => s.path.includes("/reputation/"))).toBe(false);
});

test("HD8-FR-03: máy chủ 422 khi lưu cách tính ⇒ hiện đúng câu, bản nháp còn nguyên; đổi sang Nhà cung cấp tải cách tính riêng", async ({
  page,
}) => {
  await install(page, "owner");
  await page.route(`**${P}/scoring/customer`, (r) => {
    if (r.request().method() !== "PUT") return r.fallback();
    return r.fulfill(
      json({ error: { code: "SCORING_INVALID", message: "Mức Tốt phải cao hơn mức Khá" } }, 422),
    );
  });
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  await dlg.getByLabel("Mức Tốt từ (điểm)").fill("70");
  await dlg.getByLabel("Mức Khá từ (điểm)").fill("60");
  await dlg.getByTestId("scoring-save").click();
  await expect(page.getByText("Mức Tốt phải cao hơn mức Khá")).toBeVisible();
  await expect(dlg.getByTestId("scoring-save")).toBeEnabled();
  await dlg.getByRole("radio", { name: "Nhà cung cấp" }).click();
  await expect(dlg.getByTestId("scoring-supplier")).toBeVisible();
});

test("người không phải chủ sở hữu: cách tính điểm chỉ xem (ô khoá, không có nút Lưu & tính lại)", async ({
  page,
}) => {
  await install(page, "editor");
  const dlg = await open(page);
  await dlg
    .getByRole("button", { name: /Điểm uy tín/ })
    .first()
    .click();
  await expect(dlg.getByLabel("Trọng số Đúng hạn")).toBeDisabled();
  await expect(dlg.getByTestId("scoring-save")).toHaveCount(0);
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

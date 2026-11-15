// CR-171 · e2e kỹ 5 loại HĐ (Mua, Bán, Giới thiệu, Nhượng quyền phí % / phí cố định, Hợp tác) × (AI đọc | nhập tay) × (Lưu nháp + Gửi/Xác nhận).
// Backend giả `page.route` dùng ĐÚNG luật thiếu-trường của máy chủ (`kindTermsMissing` ở @ai/contracts): thiếu ⇒ 422 KIND_TERMS_INCOMPLETE.
// Bắt lỗi người dùng: «điền hết vẫn báo thiếu» (ô tick BCT, ô AI đọc không điền sẵn, ô thiếu ở tab khác) và «dòng chưa gắn SP làm kẹt hộp Gắn sản phẩm».
// Không sleep; chờ phần tử/yêu cầu.
import { expect, type Page, type Route, test } from "@playwright/test";
import { kindTermsMissing } from "../../packages/contracts/src/pack-contracts/kind-terms";
import { AI_SUMMARY, ITEM1, REVIEW_ID, reviewContract } from "./dataset-v2g";
import { mockContractFiles } from "./flow-mock";
import type { Sent } from "./v2f-support";
import { installV2g } from "./v2g-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Deal = "buy" | "sell" | "referral" | "franchise" | "cooperation";
type Terms = Record<string, unknown>;
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const FR_PCT: Terms = {
  role: "franchisor",
  brand: "Evolu Coffee",
  fee_basis: "revenue_pct",
  fee_pct: 5,
  period: "month",
  initial_fee: 100000000,
};
const FR_FIXED: Terms = {
  role: "franchisee",
  brand: "Evolu Coffee",
  fee_basis: "fixed",
  fee_fixed: 20000000,
  period: "quarter",
};
const COOP: Terms = {
  scope: "Cùng phát triển ứng dụng",
  split_basis: "profit",
  our_share_pct: 60,
  settle_period: "quarter",
};

type Opt = {
  deal: Deal;
  mode: "ai" | "manual";
  aiTerms?: Terms;
  lines?: boolean;
  match?: "none" | "new";
};
type Fake = { sent: Sent[]; terms: Terms; confirmed: () => boolean; drafts: () => number };

const LINE = (id: string, name: string) => ({
  ...reviewContract().items[0],
  id,
  name,
  product_id: null,
});
const isKindDeal = (d: Deal): d is "franchise" | "cooperation" =>
  d === "franchise" || d === "cooperation";

/** `PUT kind-terms` của máy chủ: gộp khoá gửi lên (null = xoá) rồi bỏ khoá mâu thuẫn với lựa chọn chính. */
function applyPut(terms: Terms, patch: Terms) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete terms[k];
    else terms[k] = v;
  }
  if (terms.fee_basis === "revenue_pct") delete terms.fee_fixed;
  if (terms.fee_basis === "fixed") delete terms.fee_pct;
  if (terms.foreign_franchisor !== true) {
    delete terms.moit_registered;
    delete terms.moit_registered_on;
  }
}

/** Máy chủ giả có trạng thái: HĐ nháp + trường riêng đã ghi; Xác nhận chỉ qua khi `kindTermsMissing` rỗng. */
async function setup(page: Page, o: Opt): Promise<Fake> {
  const { sent } = await installV2g(page);
  await mockContractFiles(page);
  const S = {
    deal: o.mode === "ai" ? o.deal : ("sell" as Deal),
    terms: {} as Terms,
    version: 3,
    done: false,
    drafts: 0,
  };
  const view = () => ({
    deal: S.deal,
    terms: S.terms,
    missing: isKindDeal(S.deal) ? kindTermsMissing(S.deal, S.terms) : [],
    periods: [],
  });
  const rec = (r: Route) => {
    const q = r.request();
    let body: unknown = null;
    try {
      body = q.postDataJSON();
    } catch {
      body = q.postData();
    }
    sent.push({ method: q.method(), path: new URL(q.url()).pathname, body });
    return body as Record<string, unknown> | null;
  };
  const contract = () => {
    const base = reviewContract({
      status: S.done ? "active" : "needs_review",
      version: S.version,
      deal: S.deal,
      direction: S.deal === "buy" ? "purchase" : "sale",
      items: o.lines ? [LINE(ITEM1, "nuoc suoi")] : [],
      ...(S.deal === "referral" ? { commission_pct: 5 } : {}),
    });
    if (o.mode === "ai")
      return {
        ...base,
        ai: {
          deal: o.deal,
          unsure: [],
          summary: AI_SUMMARY,
          milestones: [],
          kind_terms: o.aiTerms ?? null,
        },
      };
    return {
      ...base,
      ai: null,
      entry_source: "manual",
      extract_state: "ready",
      reconciled_by: "11111111-1111-4111-8111-111111111111",
      reconciled_at: "2026-10-18T01:00:00.000Z",
      can: { ...(base as { can?: object }).can, submit: true },
    };
  };
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}`, (r) => {
    if (r.request().method() === "PATCH") {
      const b = rec(r);
      if (typeof b?.deal === "string") S.deal = b.deal as Deal;
      S.version++;
    }
    return json(r, 200, contract());
  });
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}/kind-terms`, (r) => {
    if (r.request().method() === "PUT") {
      applyPut(S.terms, (rec(r)?.terms ?? {}) as Terms);
    }
    return json(r, 200, view());
  });
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}/review`, (r) => {
    const b = rec(r) ?? {};
    if (typeof b.deal === "string") S.deal = b.deal as Deal;
    if (b.draft === true) {
      S.drafts++;
      S.version++;
      return json(r, 200, {
        id: REVIEW_ID,
        status: "draft",
        version: S.version,
        items: 0,
        milestones: 0,
      });
    }
    const missing = view().missing;
    if (missing.length)
      return json(r, 422, {
        error: { code: "KIND_TERMS_INCOMPLETE", message: "incomplete", details: { missing } },
      });
    S.done = true;
    S.version++;
    return json(r, 200, {
      id: REVIEW_ID,
      status: "done",
      version: S.version,
      items: 0,
      milestones: 0,
    });
  });
  // `/products/match`: «none» = không gợi ý (đúng ca người dùng bị kẹt); «new» = đề xuất tạo mới.
  await page.route("**/pack/contracts/products/match", (r) =>
    json(r, 200, { suggestions: [], create: o.match === "new" ? { name: "nuoc suoi" } : null }),
  );
  return { sent, terms: S.terms, confirmed: () => S.done, drafts: () => S.drafts };
}

const writes = (sent: Sent[], suffix: string, method?: string) =>
  sent.filter((s) => s.path.endsWith(suffix) && (!method || s.method === method));
const go = (page: Page) =>
  page.getByTestId(/^(confirm-save|act-approvalConfirm|act-resubmit)$/).first();
async function saveDraft(page: Page) {
  await page.getByTestId("head-actions-menu").click();
  await page.getByTestId("act-saveDraft").click();
}
async function open(page: Page, o: Opt) {
  const f = await setup(page, o);
  await page.goto(`/contracts/c/${REVIEW_ID}`);
  await expect(page.getByRole("radiogroup")).toBeVisible();
  return f;
}
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name }).click();
const pick = (page: Page, k: string, v: string) => page.locator(`#kt-${k}`).selectOption(v);
const fill = (page: Page, k: string, v: string) => page.locator(`#kt-${k}`).fill(v);

/** Người dùng điền tay trường riêng của loại (khi AI chưa đọc / nhập tay). */
async function fillTerms(page: Page, which: "fr-pct" | "fr-fixed" | "coop") {
  if (which === "coop") {
    await fill(page, "scope", "Cùng phát triển ứng dụng");
    await pick(page, "split_basis", "profit");
    await fill(page, "our_share_pct", "60");
    await pick(page, "settle_period", "quarter");
    return;
  }
  await pick(page, "role", which === "fr-pct" ? "franchisor" : "franchisee");
  await fill(page, "brand", "Evolu Coffee");
  await tab(page, /Phí/);
  await pick(page, "fee_basis", which === "fr-pct" ? "revenue_pct" : "fixed");
  if (which === "fr-pct") await fill(page, "fee_pct", "5");
  else await fill(page, "fee_fixed", "20.000.000");
  await pick(page, "period", "month");
}

const PLAIN: Deal[] = ["buy", "sell", "referral"];
const KIND_CASES = [
  { name: "Nhượng quyền phí %", deal: "franchise" as const, ai: FR_PCT, fill: "fr-pct" as const },
  {
    name: "Nhượng quyền phí cố định",
    deal: "franchise" as const,
    ai: FR_FIXED,
    fill: "fr-fixed" as const,
  },
  { name: "Hợp tác", deal: "cooperation" as const, ai: COOP, fill: "coop" as const },
];
const NOT_INCOMPLETE = /Còn thiếu thông tin của loại hợp đồng/;

for (const deal of PLAIN) {
  test(`AI đọc · ${deal}: Lưu nháp rồi Gửi — không bị đòi trường riêng`, async ({ page }) => {
    const f = await open(page, { deal, mode: "ai" });
    await saveDraft(page);
    await expect.poll(() => f.drafts()).toBe(1);
    expect(writes(f.sent, "/kind-terms", "PUT")).toHaveLength(0);
    await go(page).click();
    await expect(page.getByTestId("act-error")).toHaveCount(0);
  });
}

for (const c of KIND_CASES) {
  test(`AI đọc · ${c.name}: AI đọc đủ ⇒ ô điền sẵn, Lưu nháp ghi trường riêng, Gửi không báo thiếu`, async ({
    page,
  }) => {
    const f = await open(page, { deal: c.deal, mode: "ai", aiTerms: c.ai });
    if (c.deal === "franchise") await expect(page.locator("#kt-brand")).toHaveValue("Evolu Coffee");
    else await expect(page.locator("#kt-scope")).toHaveValue("Cùng phát triển ứng dụng");
    await saveDraft(page);
    await expect.poll(() => writes(f.sent, "/kind-terms", "PUT").length).toBe(1);
    expect(kindTermsMissing(c.deal, f.terms)).toEqual([]);
    await go(page).click();
    await expect(page.getByTestId("act-error")).toHaveCount(0);
    await expect(page.getByText(NOT_INCOMPLETE)).toHaveCount(0);
  });

  test(`AI đọc · ${c.name}: AI không đọc ra ô nào ⇒ người dùng điền hết thì Gửi được`, async ({
    page,
  }) => {
    const f = await open(page, { deal: c.deal, mode: "ai" });
    await fillTerms(page, c.fill);
    await go(page).click();
    await expect.poll(() => writes(f.sent, "/kind-terms", "PUT").length).toBeGreaterThan(0);
    expect(kindTermsMissing(c.deal, f.terms)).toEqual([]);
    await expect(page.getByText(NOT_INCOMPLETE)).toHaveCount(0);
  });

  test(`Nhập tay · ${c.name}: chọn Loại, điền hết, Lưu nháp + Gửi`, async ({ page }) => {
    const f = await open(page, { deal: c.deal, mode: "manual" });
    await page
      .getByRole("radio", {
        name: c.deal === "franchise" ? /^Nhượng quyền/ : /^Thỏa thuận hợp tác/,
      })
      .click();
    await fillTerms(page, c.fill);
    await saveDraft(page);
    await expect.poll(() => writes(f.sent, "/kind-terms", "PUT").length).toBe(1);
    expect(kindTermsMissing(c.deal, f.terms)).toEqual([]);
    await go(page).click();
    await expect(page.getByText(NOT_INCOMPLETE)).toHaveCount(0);
  });
}

for (const deal of PLAIN) {
  test(`Nhập tay · ${deal}: Lưu nháp gửi PATCH, không ghi trường riêng`, async ({ page }) => {
    const f = await open(page, { deal, mode: "manual" });
    if (deal !== "sell")
      await page.getByRole("radio", { name: deal === "buy" ? /^Mua/ : /^Giới thiệu/ }).click();
    await saveDraft(page);
    await expect.poll(() => writes(f.sent, "", "PATCH").length).toBe(1);
    expect(writes(f.sent, "/kind-terms", "PUT")).toHaveLength(0);
  });
}

// ---- Lỗi 1: ô nào bị đòi thì chỉ đúng ô đó (viền đỏ + tên trong câu báo), kể cả ở tab khác ----
test("Nhượng quyền thiếu ô ở tab Phí: câu báo nêu đúng tên ô, mở tab có ô đỏ, chưa gọi máy chủ", async ({
  page,
}) => {
  const f = await open(page, {
    deal: "franchise",
    mode: "ai",
    aiTerms: { role: "franchisor", brand: "Evolu Coffee" },
  });
  await go(page).click();
  await expect(page.locator("#kt-fee_basis")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#kt-period")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Thiếu:.*Cách tính phí/)).toBeVisible();
  expect(writes(f.sent, "/review")).toHaveLength(0);
  await pick(page, "fee_basis", "fixed");
  await fill(page, "fee_fixed", "5.000.000");
  await pick(page, "period", "month");
  await go(page).click();
  await expect.poll(() => writes(f.sent, "/kind-terms", "PUT").length).toBeGreaterThan(0);
  expect(kindTermsMissing("franchise", f.terms)).toEqual([]);
});

test("Nhượng quyền bên nước ngoài, không tick «Đã đăng ký Bộ Công Thương» ⇒ vẫn gửi được (không tick = chưa đăng ký)", async ({
  page,
}) => {
  const f = await open(page, {
    deal: "franchise",
    mode: "ai",
    aiTerms: { ...FR_PCT, foreign_franchisor: true },
  });
  await go(page).click();
  await expect.poll(() => writes(f.sent, "/kind-terms", "PUT").length).toBeGreaterThan(0);
  expect(f.terms.moit_registered).toBe(false);
  expect(kindTermsMissing("franchise", f.terms)).toEqual([]);
  await expect(page.getByText(NOT_INCOMPLETE)).toHaveCount(0);
});

// ---- Lỗi 2: dòng hàng chưa gắn SP không chặn; hộp «Gắn sản phẩm» hiện, tạo mới / dùng có sẵn, gửi được ----
for (const deal of ["sell", "buy", "franchise"] as const) {
  test(`AI đọc · ${deal}: dòng «nuoc suoi» chưa gắn SP ⇒ không báo thiếu, hộp Gắn sản phẩm hiện và gửi được`, async ({
    page,
  }) => {
    const f = await open(page, {
      deal,
      mode: "ai",
      aiTerms: deal === "franchise" ? FR_PCT : undefined,
      lines: true,
      match: "none",
    });
    await expect(page.getByLabel("Gắn dòng 1 với sản phẩm")).toHaveValue("");
    await go(page).click();
    await expect(page.getByText(/dòng .nuoc suoi. chưa gắn sản phẩm/)).toHaveCount(0);
    await expect(page.getByTestId("product-link-dialog")).toBeVisible();
    await expect.poll(() => f.drafts()).toBe(1);
    await page.getByTestId("plink-row-0").getByRole("radio").nth(1).check(); // Tạo sản phẩm mới
    await page.getByTestId("product-link-confirm").click();
    await expect.poll(() => f.confirmed()).toBe(true);
    const last = writes(f.sent, "/review").at(-1)?.body as { products?: unknown[] };
    expect(last.products).toHaveLength(1);
  });
}

test("AI đọc · bán: hộp Gắn sản phẩm — dùng sản phẩm có sẵn", async ({ page }) => {
  const f = await open(page, { deal: "sell", mode: "ai", lines: true, match: "none" });
  await go(page).click();
  const row = page.getByTestId("plink-row-0");
  await expect(row).toBeVisible();
  await row.getByRole("radio").nth(0).check(); // Dùng sản phẩm có sẵn
  await page.getByTestId("product-link-confirm").click();
  await expect.poll(() => f.confirmed()).toBe(true);
});

// com-c7 · ADR-0031 · R15–R28 · CR-102b: "Lưu báo giá" — cung cấp cổng `SupplierQuoteWriter` cho gói khác (community). MỘT tx RLS của
// người gọi: (tạo SP mới nếu cần, dùng lại `ProductsRepo.create` + `productPlan`) → khoá (SP, NCC, loại) → đọc giá đã lưu → MỘT câu
// thay giá Báo giá cũ + chèn giá mới (nguồn `quote`) + vai NCC nếu thiếu (điểm MỚI, R24). Số câu cố định. Không chạm kho/giá vốn/điểm
// (R25: bảng giá NCC tách khỏi `stock_moves`). Lệch > 30% / khác VAT chỉ CẢNH BÁO (form hiện), vẫn lưu.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { partyKey } from "../domain/ledger.rules";
import { localDate } from "../domain/local-time.rules";
import { productPlan } from "../domain/products.rules";
import { previewQuote, type QuotePreview, quoteInvalid } from "../domain/supplier-quote.rules";
import type { ProductsRepo } from "./products.usecase";
import type {
  QuoteCaller,
  QuoteInput,
  QuoteSaved,
  SupplierQuoteRepo,
  SupplierQuoteWriter,
} from "./supplier-quote.ports";

export class SaveQuoteFail extends Error {
  constructor(
    readonly kind: "forbidden" | "not_found" | "invalid" | "exists",
    detail: string = kind,
  ) {
    super(detail);
  }
}

export type SaveQuoteRepos = { quotes: SupplierQuoteRepo; products: ProductsRepo };
export type SaveQuoteDeps = {
  uow: PackUow<SaveQuoteRepos>;
  /** Người gọi có quyền ghi giá trong gói contracts (mount tiêm từ `PackAccessView`). */
  canWrite: (who: PackWho) => Promise<boolean>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

const PRICE_MAX = 1_000_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

/** Kiểm thân (cổng nội bộ, không qua zod của route) ⇒ khoá NCC; sai ⇒ `invalid`. */
const CHECKS: [string, (q: QuoteInput) => boolean][] = [
  ["price", (q) => Number.isInteger(q.price) && q.price >= 1 && q.price <= PRICE_MAX],
  ["supplier", (q) => between(q.supplier?.name?.trim().length ?? 0, 1, 300)],
  ["unit", (q) => (q.unit?.length ?? 0) <= 40],
  ["date", (q) => DATE.test(q.quoted_at) && (!q.expires_on || DATE.test(q.expires_on))],
  ["url", (q) => !q.url || (/^https?:\/\//.test(q.url) && q.url.length <= 2000)],
  ["origin_ref", (q) => typeof q.origin_ref?.pack === "string"],
];
const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

function checkInput(q: QuoteInput): string {
  const bad = CHECKS.find(([, ok]) => !ok(q))?.[0] ?? quoteInvalid(q);
  if (bad) throw new SaveQuoteFail("invalid", bad);
  const name = q.supplier.name.trim();
  const key = q.supplier.party_key?.trim() || partyKey(name, q.supplier.tax_id);
  if (!key || key.length > 300) throw new SaveQuoteFail("invalid", "supplier");
  return key;
}

const draftOf = (q: QuoteInput, key: string) => ({
  party_key: key,
  kind: q.kind,
  price: q.price,
  unit: q.unit?.trim() || null,
  vat_included: q.vat_included,
});

/** Tạo SP mới trong tx (cùng luật `products.usecase::create`); trùng tên ⇒ `exists`. */
async function newProduct(
  r: ProductsRepo,
  p: { name: string; unit: string | null; group: "goods" | "service" },
) {
  const body = { name: p.name.trim(), unit: p.unit?.trim() || null, group: p.group };
  const plan = productPlan(body);
  if (typeof plan === "string" || !body.name) throw new SaveQuoteFail("invalid", "product");
  try {
    const out = await r.create(body, plan);
    if (!out) throw new SaveQuoteFail("not_found");
    return out.id;
  } catch (e) {
    if (pgCode(e) === "23505") throw new SaveQuoteFail("exists", "product");
    throw e;
  }
}

export function saveQuoteUsecase(d: SaveQuoteDeps): SupplierQuoteWriter {
  const now = d.now ?? (() => new Date());
  async function guard(by: QuoteCaller): Promise<{ who: PackWho; today: string }> {
    const who = { tenantId: by.tenantId, userId: by.userId };
    if (by.kind !== "internal" || !(await d.canWrite(who))) throw new SaveQuoteFail("forbidden");
    return { who, today: localDate(now(), await d.timeZoneOf(by.tenantId)) };
  }

  async function preview(by: QuoteCaller, q: QuoteInput): Promise<QuotePreview> {
    const key = checkInput(q);
    const { who, today } = await guard(by);
    if ("new_product" in q) return { compare: { kind: "first" }, warnings: [], replaces: [] };
    const base = await d.uow.tenant(who, (r) => r.quotes.quoteBase(q.product_id));
    if (!base || base.product.group === "referral") throw new SaveQuoteFail("not_found");
    return previewQuote(draftOf(q, key), base.rows, { today, productUnit: base.product.unit });
  }

  async function save(by: QuoteCaller, q: QuoteInput): Promise<QuoteSaved> {
    const key = checkInput(q);
    const { who, today } = await guard(by);
    return d.uow.tenant(who, async (r) => {
      const created = "new_product" in q;
      const pid = created ? await newProduct(r.products, q.new_product) : q.product_id;
      await r.quotes.lockQuote(pid, key, q.kind);
      const base = await r.quotes.quoteBase(pid);
      if (!base || base.product.group === "referral") throw new SaveQuoteFail("not_found");
      const pv = previewQuote(draftOf(q, key), base.rows, {
        today,
        productUnit: base.product.unit,
      });
      const s = await r.quotes.saveQuote(pid, { ...q, party_key: key });
      if (!s) throw new SaveQuoteFail("not_found");
      return {
        ...pv,
        replaces: s.replaced,
        price_id: s.id,
        product_id: pid,
        product_created: created,
        supplier_party_key: key,
        supplier_created: s.supplier_created,
      };
    });
  }

  return { preview, save };
}

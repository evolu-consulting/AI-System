// gap-d1 · luật thuần của các form Sản phẩm & Giá (không React): kiểm đầu vào ⇒ thân API, hoặc null khi chưa hợp lệ.
import type {
  ProductCreate,
  ProductGroup,
  ProductLotCreate,
  ProductRuleCreate,
  ProductSourceCreate,
} from "@ai/contracts";

const QTY = /^\d{1,14}([.,]\d{1,4})?$/;
const str = (s: string): string | null => (s.trim() === "" ? null : s.trim());
/** Số nguyên dương từ chuỗi có thể kèm dấu chấm/khoảng trắng ngăn nghìn ("1.200.000"); sai ⇒ null. */
export function moneyOf(s: string): number | null {
  const n = Number(s.replace(/[.\s,]/g, ""));
  return /^[\d.\s,]+$/.test(s.trim()) && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const qtyOf = (s: string): string | null => {
  const q = s.trim().replace(",", ".");
  return QTY.test(s.trim()) && Number(q) > 0 ? q : null;
};

export type ProductForm = { name: string; group: ProductGroup; unit: string; spec: string };
/** #18 · thêm SP tay: cần tên; nhóm Giới thiệu không cần đơn vị. */
export function productBody(f: ProductForm): ProductCreate | null {
  if (!str(f.name)) return null;
  return {
    name: f.name.trim(),
    group: f.group,
    unit: str(f.unit),
    spec: str(f.spec),
  };
}

export type LotForm = {
  qty: string;
  price: string;
  date: string;
  expires: string;
  supplier: string;
  taxId: string;
  componentId: string;
};
/** #18 · nhập lô tay; `quota` ⇒ bắt buộc hạn gói. */
export function lotBody(f: LotForm, quota: boolean): ProductLotCreate | null {
  const qty = qtyOf(f.qty);
  const unit_price = moneyOf(f.price);
  if (!qty || unit_price === null) return null;
  if (quota && !f.expires) return null;
  const supplier = str(f.supplier);
  return {
    qty,
    unit_price,
    component_id: str(f.componentId),
    received_on: str(f.date),
    expires_on: quota ? str(f.expires) : null,
    supplier: supplier ? { name: supplier, tax_id: str(f.taxId) } : null,
  };
}

export type SourceForm = {
  supplier: string;
  taxId: string;
  leadDays: string;
  moq: string;
  priceRef: string;
  note: string;
};
/** #19 · thêm cách lấy hàng: cần NCC; số ngày/SL tối thiểu/giá tham chiếu tuỳ chọn nhưng nếu có phải đúng. */
export function sourceBody(f: SourceForm): ProductSourceCreate | null {
  if (!str(f.supplier)) return null;
  const lead = str(f.leadDays);
  const moq = str(f.moq);
  const ref = str(f.priceRef);
  const lead_days = lead === null ? null : /^\d{1,4}$/.test(lead) ? Number(lead) : undefined;
  const moqV = moq === null ? null : qtyOf(moq);
  const price_ref = ref === null ? null : moneyOf(ref);
  if (lead_days === undefined || (moqV === null && moq !== null)) return null;
  if (price_ref === 0 || (ref !== null && price_ref === null)) return null;
  return {
    supplier_name: f.supplier.trim(),
    supplier_tax_id: str(f.taxId),
    lead_days,
    moq: moqV,
    price_ref,
    note: str(f.note),
  };
}

/** #20 · quy tắc nhận diện: 2–100 ký tự; `componentId` rỗng = cả SP. */
export function ruleBody(pattern: string, componentId: string): ProductRuleCreate | null {
  const p = pattern.trim();
  if (p.length < 2 || p.length > 100) return null;
  return { pattern: p, component_id: str(componentId) };
}

/** Giá vốn BQ dự kiến sau khi nhập lô (xem trước): (tồn×BQ + SL×giá) / (tồn + SL), làm tròn đồng; chưa đủ số ⇒ null. */
export function avgPreview(onHand: string, avg: number, qty: string, price: string): number | null {
  const q = Number(qty.replace(",", "."));
  const p = moneyOf(price);
  const h = Number(onHand);
  if (!(q > 0) || p === null || !Number.isFinite(h)) return null;
  return Math.round((h * avg + q * p) / (h + q));
}

export const RISK_TONE = { high: "text-late", medium: "text-soon", low: "text-ok" } as const;

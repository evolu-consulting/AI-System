// CR-102b · C7b · logic thuần form "Lưu báo giá" (điền sẵn từ bài, kiểm lỗi, câu so giá/cảnh báo, thân gửi). Không React/DOM.
import type {
  HostHint,
  PostView,
  QuoteCompare,
  QuoteInput,
  QuoteMark,
  QuoteWarning,
} from "@ai/contracts/community";
import { numLocale, t } from "../i18n";

export type QuoteDraft = {
  /** Sản phẩm: id có sẵn, hoặc "new" = tạo mới theo `newName`. */
  productId: string | "new";
  newName: string;
  supplier: string;
  price: string;
  unit: string;
  vatIncluded: boolean;
  kind: "new" | "renew";
  quotedAt: string;
  expiresOn: string;
  notify: boolean;
  itemIdx: number;
  commentId?: string;
};

const THOUSANDS = ["k", "nghìn", "ngàn"]; // i18n-ignore: hậu tố tiền Việt
/** "95.000đ" → 95000; "95k" → 95000; "1,2tr" → 1200000; không đọc được ⇒ null. */
export function parseVnd(text: string | null | undefined): number | null {
  const s = (text ?? "").toLowerCase().replace(/\s/g, "");
  const m = /^(\d+(?:[.,]\d+)*)(k|nghìn|ngàn|tr|triệu)?/u.exec(s); // i18n-ignore: đơn vị tiền VN
  if (!m) return null;
  const num = m[1] as string;
  const mult = THOUSANDS.includes(m[2] ?? "") ? 1_000 : m[2] ? 1_000_000 : 1;
  if (mult === 1) {
    const n = Number(num.replace(/[.,]/g, ""));
    return n > 0 ? n : null;
  }
  const n = Math.round(Number(num.replace(/\./g, "").replace(",", ".")) * mult);
  return n > 0 ? n : null;
}

/** "100 cuộn" → "cuộn" (chữ sau số đầu tiên); không có ⇒ "". */
export function unitFromQty(qty: string | null | undefined): string {
  const m = /^\s*[\d.,]+(?![\d.,])\s*(.+)$/u.exec(qty ?? "");
  return (m?.[1] ?? "").trim().slice(0, 40);
}

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Điền sẵn từ bài (R17): SP khớp (nếu có), NCC = công ty đăng / công ty luồng, giá + đơn vị từ mặt hàng. */
export function prefill(
  post: PostView,
  o: {
    supplier: string;
    hint?: HostHint | undefined;
    commentId?: string;
    itemIdx?: number;
    now?: Date;
  },
): QuoteDraft {
  const match = o.hint?.match ?? null;
  return {
    productId: match ? match.productId : "new",
    newName: (post.fields.product ?? "").trim(),
    supplier: o.supplier,
    price: o.commentId ? "" : String(parseVnd(post.fields.price) ?? ""),
    unit: match?.unit ?? unitFromQty(post.fields.qty),
    vatIncluded: true,
    kind: "new",
    quotedAt: todayIso(o.now),
    expiresOn: "",
    notify: true,
    itemIdx: o.itemIdx ?? 0,
    ...(o.commentId ? { commentId: o.commentId } : {}),
  };
}

export type QuoteErrors = Partial<Record<"product" | "price" | "date" | "expires", string>>;

export function quoteErrors(d: QuoteDraft): QuoteErrors {
  const e: QuoteErrors = {};
  if (d.productId === "new" && d.newName.trim() === "") e.product = t("community.quote.errProduct");
  const p = parseVnd(d.price);
  if (p === null) e.price = t("community.quote.errPrice");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.quotedAt)) e.date = t("community.quote.errDate");
  if (d.expiresOn && d.expiresOn < d.quotedAt) e.expires = t("community.quote.errExpires");
  return e;
}

export const hasErrors = (e: QuoteErrors): boolean => Object.keys(e).length > 0;

/** Thân gửi server (đã hợp lệ). */
export function toQuoteInput(d: QuoteDraft): QuoteInput {
  return {
    itemIdx: d.itemIdx,
    ...(d.commentId ? { commentId: d.commentId } : {}),
    ...(d.productId === "new"
      ? {
          newProduct: {
            name: d.newName.trim(),
            unit: d.unit.trim() || null,
            group: "goods" as const,
          },
        }
      : { productId: d.productId }),
    price: parseVnd(d.price) ?? 0,
    unit: d.unit.trim() || null,
    vatIncluded: d.vatIncluded,
    kind: d.kind,
    quotedAt: d.quotedAt,
    expiresOn: d.expiresOn || null,
    notify: d.notify,
  };
}

/** Tiền VND: dấu chấm phân nghìn + hậu tố đ (cùng kiểu ở cả hai ngôn ngữ). */
export const vnd = (n: number): string => `${n.toLocaleString("vi-VN")}đ`; // i18n-ignore

/** So với giá đã ghi nhận: bằng / rẻ hơn / đắt hơn bao nhiêu, hoặc "giá đầu tiên". */
export function compareText(c: QuoteCompare): string {
  if (c.kind === "first") return t("community.quote.first");
  const ref = `${vnd(c.refPrice)} (${c.refSupplier})`;
  if (c.kind === "equal") return t("community.quote.equal", { ref });
  const n = vnd(Math.abs(c.diff));
  const pct = Math.abs(c.pct).toLocaleString(numLocale());
  return t(c.kind === "cheaper" ? "community.quote.cheaper" : "community.quote.pricier", {
    n,
    pct,
    ref,
  });
}

export function warningText(w: QuoteWarning): string {
  return w.code === "deviation"
    ? t("community.quote.warnDeviation", {
        pct: Math.abs(w.pct).toLocaleString(numLocale()),
        price: vnd(w.refPrice),
      })
    : t("community.quote.warnVat", { price: vnd(w.refPrice) });
}

/** "đã lưu bởi … lúc …" (R28/HT-63). */
export function savedText(m: Pick<QuoteMark, "by" | "at" | "price" | "unit">): string {
  const when = new Date(m.at).toLocaleString(numLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  });
  return t("community.quote.savedBy", {
    price: vnd(m.price),
    unit: m.unit ? ` / ${m.unit}` : "",
    by: m.by,
    when,
  });
}

/** Nhãn nút theo số báo giá đã lưu của bài (R26). */
export const saveButtonLabel = (savedCount: number): string =>
  savedCount > 0 ? t("community.quote.saveMore") : t("community.quote.save");

/** Gợi ý dưới bài (HT-67) thành các dòng chữ ngắn; Cần mua + có hàng ⇒ "khớp hàng đang có". */
export function hintLines(h: HostHint, type: PostView["type"]): { lead: string; text: string } {
  if (!h.match)
    return { lead: t("community.quote.hintLead"), text: t("community.quote.hintNoMatch") };
  const parts: string[] = [];
  if (h.onHand !== null)
    parts.push(t("community.quote.hintOnHand", { n: h.onHand, unit: h.match.unit ?? "" }).trim());
  if (h.avgCost !== null) parts.push(t("community.quote.hintAvgCost", { price: vnd(h.avgCost) }));
  if (h.best)
    parts.push(
      t("community.quote.hintBest", { price: vnd(h.best.price), supplier: h.best.supplier }),
    );
  if (h.reputation)
    parts.push(
      t("community.quote.hintReputation", {
        score: h.reputation.score ?? t("community.quote.hintNew"),
      }),
    );
  const lead = type === "buy" && h.inStock ? t("community.quote.hintInStock") : `${h.match.name}:`;
  return { lead, text: parts.length ? parts.join(" · ") : t("community.quote.hintNoData") };
}

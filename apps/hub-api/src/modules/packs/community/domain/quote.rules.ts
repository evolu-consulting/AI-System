// CR-102b · C7b/C8 · luật thuần của "Lưu báo giá" + gợi ý SHT dưới bài (chỉ chủ quản): nguồn nào được lưu, dựng thân cổng ghi,
// chọn mặt hàng để hỏi sổ, gộp kết quả đọc thành gợi ý từng bài. Không DB/mạng.
import type {
  HostHint,
  QuoteCompare,
  QuoteInput,
  QuotePreview,
  QuoteWarning,
} from "@ai/contracts/community";
import type {
  HostBookOut,
  HostProductOut,
  QuoteCompare as PortCompare,
  QuoteInput as PortInput,
  QuoteWarning as PortWarning,
} from "../application/pack-ports";

export type QuoteSourcePost = { type: "sell" | "buy" | "note"; author_org: string | null };

/** Nút Lưu báo giá (nghiep-vu §8): bài Cần bán của NCC (đối tác), hoặc bình luận của NCC trên bài Cần mua của CHỦ QUẢN. */
export function quoteSourceOk(
  post: QuoteSourcePost,
  comment: { author_org: string | null } | null,
): boolean {
  if (comment === null) return post.type === "sell" && post.author_org !== null;
  return post.type === "buy" && post.author_org === null && comment.author_org !== null;
}

/** Thân gọi cổng ghi từ form + nguồn đã kiểm (NCC do server suy từ nguồn, không tin client). */
export function toPortInput(
  q: QuoteInput & { itemIdx?: number },
  s: { postId: string; supplierName: string; partyKey: string | null; url: string | null },
): PortInput {
  const base = {
    supplier: { name: s.supplierName, ...(s.partyKey ? { party_key: s.partyKey } : {}) },
    price: q.price,
    unit: q.unit?.trim() || null,
    vat_included: q.vatIncluded,
    kind: q.kind ?? "new",
    quoted_at: q.quotedAt,
    expires_on: q.expiresOn ?? null,
    origin_ref: {
      pack: "community",
      post_id: s.postId,
      item_idx: q.itemIdx ?? 0,
      comment_id: q.commentId ?? null,
    },
    url: s.url,
  };
  return q.productId !== undefined
    ? { ...base, product_id: q.productId }
    : {
        ...base,
        new_product: {
          name: (q.newProduct?.name ?? "").trim(),
          unit: q.newProduct?.unit?.trim() || null,
          group: q.newProduct?.group ?? "goods",
        },
      };
}

const compareView = (c: PortCompare): QuoteCompare =>
  c.kind === "first"
    ? { kind: "first" }
    : {
        kind: c.kind,
        refPrice: c.ref_price,
        refSupplier: c.ref_supplier,
        diff: c.diff,
        pct: c.pct,
      };
const warningView = (w: PortWarning): QuoteWarning =>
  w.code === "deviation"
    ? { code: "deviation", pct: w.pct, refPrice: w.ref_price }
    : { code: "vat_differs", refPrice: w.ref_price };

export function previewView(
  p: { compare: PortCompare; warnings: PortWarning[]; replaces: string[] },
  existing: { by: string; at: string } | null,
): QuotePreview {
  return {
    compare: compareView(p.compare),
    warnings: p.warnings.map(warningView),
    replaces: p.replaces.length,
    existing: existing ? { by: existing.by, at: new Date(existing.at).toISOString() } : null,
  };
}

export type HintPost = {
  id: string;
  type: "sell" | "buy" | "note";
  author_org: string | null;
  fields: Record<string, string | null>;
  party_key: string | null;
};

/** Bài cần hỏi sổ: bài đối tác (Cần bán/Cần mua) có tên hàng. Bài chủ quản và Thông báo: không. */
export const hintable = (p: HintPost): boolean =>
  p.author_org !== null && p.type !== "note" && (p.fields.product ?? "").trim() !== "";

/** Một lô cho cả trang: gợi ý theo tên mặt hàng + khoá đối tác (NCC của bài Cần bán) — một lời gọi cổng. */
export function pageQuery(posts: readonly HintPost[]) {
  const picked = posts.filter(hintable);
  const keys = picked.flatMap((p) => (p.type === "sell" && p.party_key ? [p.party_key] : []));
  return {
    postIds: picked.map((p) => p.id),
    hints: picked.map((p) => ({ name: (p.fields.product ?? "").trim() })),
    partyKeys: [...new Set(keys)],
  };
}

export function hostHintOf(
  prod: HostProductOut,
  partners: HostBookOut["partners"],
  partyKey: string | null,
): HostHint {
  const best = [...prod.prices].sort((a, b) => a.price - b.price)[0];
  const rep = partyKey ? partners.find((x) => x.partyKey === partyKey) : undefined;
  return {
    match: prod.match
      ? {
          productId: prod.match.id,
          name: prod.match.name,
          unit: prod.match.unit,
          how: prod.match.how,
        }
      : null,
    onHand: prod.onHand,
    avgCost: prod.avgCost,
    best: best
      ? {
          price: best.price,
          unit: best.unit,
          supplier: best.supplierName,
          vatIncluded: best.vatIncluded,
          seenOn: best.seenOn,
        }
      : null,
    reputation: rep?.band ? { band: rep.band, score: rep.score } : null,
    inStock: prod.match !== null && prod.onHand !== null && Number(prod.onHand) > 0,
  };
}

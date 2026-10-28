// CR-102b · C7b/C8 · service Lưu báo giá + gợi ý SHT (chỉ chủ quản). Nguồn kiểm trong tx community (RLS chủ quản); giá ghi qua cổng
// `SupplierQuoteWriter` (tx riêng của contracts, ADR-0031); dấu "đã lưu" ghi lại ở community. Gợi ý: MỘT lời gọi `HostBookReader` mỗi trang.
import type { HostHint, QuoteInput, QuotePreview, QuoteSaved } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/application/ports";
import {
  type HostBookReader,
  QUOTE_FAIL_KINDS,
  type QuoteCaller,
  type SupplierQuoteWriter,
} from "../application/pack-ports";
import {
  type HintPost,
  hostHintOf,
  pageQuery,
  previewView,
  quoteSourceOk,
  toPortInput,
} from "../domain/quote.rules";
import type { Access } from "./community-access";
import type { PostRow } from "./post.sql";
import { existingSave, quoteSource, type SavedRow, upsertSave } from "./quote.repo";
import { namesOf } from "./views";

type Uow = PackUow<{ tx: Tx }>;
export type QuoteDeps = {
  uow: Uow;
  quotes: SupplierQuoteWriter | undefined;
  hostBook: HostBookReader | undefined;
  webUrl: string | undefined;
};

const forbidden = () => new AppError("PACK_FORBIDDEN", 403, "Forbidden");

/** Chỉ thành viên chủ quản (đối tác ⇒ 403, không lộ gì thêm). */
export function requireHost(a: Access): void {
  if (a.org !== null || a.who.userKind === "external") throw forbidden();
}

const callerOf = (a: Access): QuoteCaller => ({
  tenantId: a.who.tenantId,
  userId: a.who.userId,
  kind: a.who.userKind === "external" ? "external" : "internal",
});

/** Lỗi cổng ghi ⇒ AppError (so khớp theo `kind`, không phụ thuộc lớp của gói kia). */
function mapFail(e: unknown): never {
  const kind = (e as { kind?: string }).kind;
  if (!(QUOTE_FAIL_KINDS as readonly string[]).includes(kind ?? "")) throw e;
  if (kind === "forbidden") throw forbidden();
  if (kind === "not_found") throw appError("NOT_FOUND");
  if (kind === "exists") throw new AppError("PRODUCT_EXISTS", 409, "Product already exists");
  throw new AppError("VALIDATION_ERROR", 422, (e as Error).message);
}

const needWriter = (d: QuoteDeps): SupplierQuoteWriter => {
  if (!d.quotes) throw new AppError("QUOTE_UNAVAILABLE", 503, "Quote writer not wired");
  return d.quotes;
};

async function sourceOf(d: QuoteDeps, a: Access, postId: string, q: QuoteInput) {
  const src = await d.uow.tenant(a.who, ({ tx }) => quoteSource(tx, postId, q.commentId ?? null));
  if (!src || src.comment_missing) throw appError("NOT_FOUND");
  if (!quoteSourceOk(src, src.comment))
    throw new AppError("QUOTE_NOT_ALLOWED", 422, "This post/comment cannot be saved as a quote");
  if (!src.supplier_org) throw appError("NOT_FOUND");
  const name = namesOf(a).orgName(src.supplier_org);
  return toPortInput(q, {
    postId,
    supplierName: name,
    partyKey: src.party_key,
    url: d.webUrl ? `${d.webUrl.replace(/\/$/, "")}/#/feed` : null,
  });
}

export async function preview(
  d: QuoteDeps,
  a: Access,
  postId: string,
  q: QuoteInput,
): Promise<QuotePreview> {
  requireHost(a);
  const w = needWriter(d);
  const input = await sourceOf(d, a, postId, q);
  const p = await w.preview(callerOf(a), input).catch(mapFail);
  const ex = await d.uow.tenant(a.who, ({ tx }) =>
    existingSave(tx, postId, q.itemIdx ?? 0, q.commentId ?? null),
  );
  return previewView(p, ex);
}

export async function save(
  d: QuoteDeps,
  a: Access,
  postId: string,
  q: QuoteInput,
): Promise<QuoteSaved> {
  requireHost(a);
  const w = needWriter(d);
  const input = await sourceOf(d, a, postId, q);
  const s = await w.save(callerOf(a), input).catch(mapFail);
  const prev: SavedRow | null = await d.uow.tenant(a.who, ({ tx }) =>
    upsertSave(tx, {
      tenantId: a.who.tenantId,
      postId,
      commentId: q.commentId ?? null,
      itemIdx: q.itemIdx ?? 0,
      userId: a.who.userId,
      userName: a.dir.userName,
      priceId: s.price_id,
      productId: s.product_id,
      supplier: input.supplier.name,
      price: q.price,
      unit: input.unit,
      notify: q.notify ?? true,
    }),
  );
  return {
    ...previewView(s, prev),
    productId: s.product_id,
    productCreated: s.product_created,
    supplierCreated: s.supplier_created,
    mark: {
      itemIdx: q.itemIdx ?? 0,
      ...(q.commentId ? { commentId: q.commentId } : {}),
      by: a.dir.userName,
      at: new Date().toISOString(),
      productId: s.product_id,
      supplier: input.supplier.name,
      price: q.price,
      unit: input.unit,
      postEdited: false,
      priceEdited: false,
    },
  };
}

/**
 * Gợi ý cho cả trang (HT-67): MỘT lời gọi cổng đọc cho mọi bài đối tác Cần bán/Cần mua. Không có quyền đọc gói contracts / cổng vắng ⇒
 * không gợi ý (không lỗi). Đối tác: không bao giờ gọi.
 */
export async function hostHints(
  d: QuoteDeps,
  a: Access,
  items: readonly PostRow[],
): Promise<Map<string, HostHint>> {
  const out = new Map<string, HostHint>();
  if (a.org !== null || !d.hostBook) return out;
  const posts: HintPost[] = items.map((p) => ({
    id: p.id,
    type: p.type,
    author_org: p.author_org,
    fields: p.fields,
    party_key: p.party_key,
  }));
  const q = pageQuery(posts);
  if (q.hints.length === 0) return out;
  try {
    const r = await d.hostBook.read(
      { ...a.who, kind: "internal" },
      { hints: q.hints, partyKeys: q.partyKeys },
    );
    q.postIds.forEach((id, i) => {
      const prod = r.products[i];
      if (prod)
        out.set(
          id,
          hostHintOf(prod, r.partners, posts.find((p) => p.id === id)?.party_key ?? null),
        );
    });
  } catch (e) {
    if ((e as { kind?: string }).kind !== "forbidden") throw e;
  }
  return out;
}

/** `GET /quote/match?q=`: SP khớp tên gõ (gợi ý form). */
export async function matchHint(d: QuoteDeps, a: Access, text: string): Promise<HostHint> {
  requireHost(a);
  const r = await d.hostBook
    ?.read({ ...a.who, kind: "internal" }, { hints: [{ name: text }] })
    .catch((e: unknown) => {
      if ((e as { kind?: string }).kind === "forbidden") throw forbidden();
      throw e;
    });
  const prod = r?.products[0];
  if (!prod)
    return hostHintOf(
      { index: 0, hint: {}, match: null, onHand: null, avgCost: null, prices: [] },
      [],
      null,
    );
  return hostHintOf(prod, r?.partners ?? [], null);
}

/**
 * C8 → C9: chủ quản có hàng khớp tên bài Cần mua (nguồn thông báo `matchBuy`). Mỗi chủ quản một lời gọi cổng đọc (quyền đọc SHT theo
 * người; số chủ quản nhỏ, ≤ 50, song song); không quyền / lỗi ⇒ không nhận.
 */
export function stockMatchVia(
  hostBook: HostBookReader,
  hosts: (tenantId: string) => Promise<readonly string[]>,
): (tenantId: string, product: string) => Promise<readonly string[]> {
  return async (tenantId, product) => {
    const users = (await hosts(tenantId)).slice(0, 50);
    const hits = await Promise.all(
      users.map(async (userId) => {
        try {
          const r = await hostBook.read(
            { tenantId, userId, kind: "internal" },
            { hints: [{ name: product }] },
          );
          const p = r.products[0];
          return p?.match && p.onHand !== null && Number(p.onHand) > 0 ? userId : null;
        } catch {
          return null;
        }
      }),
    );
    return hits.filter((u): u is string => u !== null);
  };
}

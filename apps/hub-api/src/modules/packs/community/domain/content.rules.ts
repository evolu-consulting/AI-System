// CR-102 · com-c3 · D4 · nghiep-vu §7: dựng cột raw + masked + hits lúc GHI (lớp 1). Nội dung đối tác: che liên hệ + tên công
// ty khác (`mask.rules`); nội dung chủ quản: không che (masked = raw). Raw lưu đã chuẩn hoá NFKC để offset `hits` khớp.
import { type ContactKind, maskContacts, normalizeText } from "./mask.rules";

export type HitKind = "phone" | "email" | "link" | "taxId" | "company";
export type ContentHit = { field: "title" | "body"; start: number; end: number; kind: HitKind };
export type Fields = Record<string, string | null>;

const KIND: Record<ContactKind, HitKind> = {
  phone: "phone",
  email: "email",
  link: "link",
  tax_code: "taxId",
  company_name: "company",
};

export type StoredText = { raw: string; masked: string; hits: ContentHit[] };
export type StoredContent = {
  title: StoredText;
  body: StoredText;
  fields: { raw: Fields; masked: Fields };
  /** Nhắc người đăng (HT-54) — không chặn đăng. */
  contactDetected: boolean;
};

function one(text: string, field: "title" | "body", others: readonly string[] | null): StoredText {
  const raw = normalizeText(text);
  if (others === null) return { raw, masked: raw, hits: [] };
  const m = maskContacts(raw, { otherCompanies: others });
  return {
    raw,
    masked: m.masked,
    hits: m.hits.map((h) => ({ field, start: h.start, end: h.end, kind: KIND[h.kind] })),
  };
}

/** `others = null` ⇒ người viết là chủ quản (không che). Ngược lại: tên các công ty đối tác KHÁC công ty người viết. */
export function storeContent(
  input: { title: string; body: string; fields: Fields },
  others: readonly string[] | null,
): StoredContent {
  const title = one(input.title, "title", others);
  const body = one(input.body, "body", others);
  const raw: Fields = {};
  const masked: Fields = {};
  let fieldHit = false;
  for (const [k, v] of Object.entries(input.fields)) {
    if (v === null) {
      raw[k] = null;
      masked[k] = null;
      continue;
    }
    const s = one(v, "body", others);
    raw[k] = s.raw;
    masked[k] = s.masked;
    if (s.hits.length > 0) fieldHit = true;
  }
  return {
    title,
    body,
    fields: { raw, masked },
    contactDetected: fieldHit || title.hits.length > 0 || body.hits.length > 0,
  };
}

/** Một bình luận: như `storeContent` cho một trường (`body`). */
export function storeComment(text: string, others: readonly string[] | null): StoredText {
  return one(text, "body", others);
}

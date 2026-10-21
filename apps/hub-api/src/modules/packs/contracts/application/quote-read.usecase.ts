// gap-d1 #21 · "Tải báo giá lên": tệp (PDF có lớp chữ hoặc văn bản) ⇒ chữ ⇒ AI đọc qua AI client chung ⇒ parse chặt ⇒ dòng giá CHƯA
// LƯU. Tệp chỉ tồn tại trong bộ nhớ yêu cầu (không lưu FileBox). SP phải có tab NCC & giá (không Giới thiệu). Trần thao tác AI/ngày
// của tenant tính sau khi tệp đã qua kiểm loại/kích thước. Lỗi ⇒ `SupplierFail`.
import type { PackWho } from "../../kit/application/ports";
import type { PdfConverter } from "../../kit/domain/pdf.rules";
import { localDate } from "../domain/local-time.rules";
import { parseQuoteReply, quoteFileKind, quotePrompt } from "../domain/quote-read.rules";
import { QUOTE_MAX_BYTES, type QuoteReadOut } from "../domain/supplier-prices.types";
import type { ActionQuota } from "./ai.ports";
import { SupplierFail } from "./supplier-prices.usecase";

/** AI đọc báo giá (không tìm web). Không ném. */
export type QuoteAi = (
  who: PackWho,
  r: { productId: string; prompt: string; signal: AbortSignal },
) => Promise<{ ok: true; text: string } | { ok: false; code: "cap" | "unavailable" | "failed" }>;

export const QUOTE_TIMEOUT_MS = 120_000;

export type QuoteDeps = {
  /** Tên + nhóm của SP (null ⇒ không có / không thuộc tenant). */
  head: (
    who: PackWho,
    productId: string,
  ) => Promise<{ name: string; group: "service" | "goods" | "referral" } | null>;
  ai: QuoteAi | null;
  pdf: PdfConverter;
  quota: ActionQuota;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

/** Chữ của tệp (văn bản trực tiếp; PDF qua `PdfConverter`); rỗng / PDF scan ⇒ `unreadable`. */
async function textOf(
  pdf: PdfConverter,
  who: PackWho,
  kind: "pdf" | "text",
  bytes: Uint8Array,
): Promise<string> {
  let s: string;
  if (kind === "text") s = new TextDecoder().decode(bytes);
  else {
    const r = await pdf.toText(bytes, { tenantId: who.tenantId });
    s = r.ok ? r.markdown : "";
  }
  if (!s.trim()) throw new SupplierFail("unreadable");
  return s;
}

export function quoteReadUsecase(d: QuoteDeps) {
  const now = d.now ?? (() => new Date());
  return {
    async read(who: PackWho, productId: string, bytes: Uint8Array): Promise<QuoteReadOut> {
      const p = await d.head(who, productId);
      if (!p || p.group === "referral") throw new SupplierFail("not_found");
      if (bytes.byteLength > QUOTE_MAX_BYTES) throw new SupplierFail("too_large");
      const kind = quoteFileKind(bytes);
      if (kind === "unsupported") throw new SupplierFail("unsupported");
      if (!d.ai) throw new SupplierFail("unavailable");
      const quoteText = await textOf(d.pdf, who, kind, bytes);
      await d.quota(who.tenantId);
      const out = await d.ai(who, {
        productId,
        prompt: quotePrompt(p.name, quoteText),
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      });
      if (!out.ok) throw new SupplierFail(out.code);
      const today = localDate(now(), await d.timeZoneOf(who.tenantId));
      const items = parseQuoteReply(out.text, today);
      if (!items) throw new SupplierFail("failed");
      return { items };
    },
  };
}
export type QuoteReadUsecase = ReturnType<typeof quoteReadUsecase>;

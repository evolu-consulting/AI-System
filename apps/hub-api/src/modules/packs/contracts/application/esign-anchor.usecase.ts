// esign-anchor · use case vị trí ô ký: danh sách cụm theo công ty (xem/sửa), chọn vị trí cho một lần gửi ký (văn bản HĐ ⇒ anchor
// văn bản; không ⇒ trang ký cuối), xem trước vị trí cho hộp Gửi ký. Nguồn chữ của file HIỆN HÀNH: `source_text` (trích lúc tải lên
// từ chính tệp) ⇒ không có thì lớp chữ của PDF (bytes đang gửi). Lỗi đọc chữ ⇒ trang ký cuối (không chặn gửi ký). Không log nội dung.
import type { ESignAnchorsIn, ESignAnchorsOut, ESignPlacement } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { PdfConverter } from "../../kit/domain/pdf.rules";
import {
  type AnchorLists,
  type AnchorPick,
  cleanList,
  companySideOf,
  DEFAULT_ANCHORS,
  pickAnchors,
  type SignerRole,
} from "../domain/esign.anchor";
import { ESignFail } from "./esign.helpers";
import type { ESignFiles } from "./esign.ports";

export type ESignAnchorSource = {
  deal: string | null;
  direction: string | null;
  text: string | null;
  file: { org: string; fileId: string; mime: string } | null;
};
export type ESignAnchorRepo = {
  /** Danh sách đã lưu; chưa lưu ⇒ null (mặc định). */
  lists(): Promise<AnchorLists | null>;
  saveLists(l: AnchorLists, actor: string): Promise<void>;
  /** HĐ thấy được (RLS + M1) hoặc null. */
  source(contractId: string): Promise<ESignAnchorSource | null>;
};
type R = { anchor: ESignAnchorRepo };

export type ESignAnchorDeps = {
  uow: PackUow<R>;
  files: ESignFiles | null;
  /** Converter của lúc GỬI ký. */
  pdf: Pick<PdfConverter, "toText"> | null;
  /** esign-anchor-fix · converter/hàng chờ RIÊNG cho xem trước (quyền read) — bận ⇒ "unknown", không chiếm chỗ của lúc gửi. */
  previewPdf?: Pick<PdfConverter, "toText"> | null;
  /** Số tệp giữ chữ trích trong bộ nhớ (mặc định 200). */
  cacheSize?: number;
};

type Conv = Pick<PdfConverter, "toText">;
const BUSY = Symbol("busy");
const FAIL = Symbol("fail");

export function esignAnchors(d: ESignAnchorDeps) {
  const listsOut = (l: AnchorLists | null): ESignAnchorsOut => ({
    ...(l ?? DEFAULT_ANCHORS),
    is_default: l === null,
  });
  // esign-anchor-fix · chữ trích theo (tenant, file_id) — tệp HĐ bất biến (phiên bản mới = file_id mới) ⇒ cache an toàn; kết quả
  // cuối (chữ / scan / hỏng) mới lưu, bận thì không. FIFO có trần.
  const cap = d.cacheSize ?? 200;
  const cache = new Map<string, string | null>();
  const remember = (k: string, v: string | null) => {
    cache.set(k, v);
    if (cache.size > cap) cache.delete(cache.keys().next().value as string);
  };

  /** Chữ của tệp: `source_text` ⇒ cache ⇒ lớp chữ PDF (bytes có sẵn hoặc tải FileBox); lỗi/scan ⇒ null; converter bận ⇒ BUSY. */
  const textOf = async (
    who: PackWho,
    s: ESignAnchorSource,
    conv: Conv | null | undefined,
    bytes?: Uint8Array,
  ): Promise<string | null | typeof BUSY> => {
    if (s.text?.trim()) return s.text;
    if (s.file?.mime !== "application/pdf") return null;
    const k = `${who.tenantId}:${s.file.fileId}`;
    if (cache.has(k)) return cache.get(k) ?? null;
    if (!conv) return null;
    const t = await extract(who, s.file, conv, bytes).catch((): typeof FAIL => FAIL);
    if (t === FAIL) return null;
    if (t !== BUSY) remember(k, t);
    return t;
  };

  /** Tải (nếu chưa có bytes) + đọc lớp chữ; bận ⇒ BUSY; tải lỗi/thiếu ⇒ ném (không cache); scan/hỏng ⇒ null (cache). */
  const extract = async (
    who: PackWho,
    f: NonNullable<ESignAnchorSource["file"]>,
    conv: Conv,
    bytes?: Uint8Array,
  ): Promise<string | null | typeof BUSY> => {
    const b = bytes ?? (d.files ? await d.files(f.org).getContent(f.fileId) : null);
    if (!b) throw new Error("file-unavailable");
    const r = await conv.toText(b, { tenantId: who.tenantId });
    if (r.ok) return r.markdown;
    return r.code === "PDF_BUSY" ? BUSY : null;
  };

  const load = async (who: PackWho, id: string) => {
    const got = await d.uow.tenant(who, async (r) => ({
      s: await r.anchor.source(id),
      l: await r.anchor.lists(),
    }));
    if (!got.s) throw new ESignFail("NOT_FOUND", "contract");
    return { s: got.s, l: got.l ?? DEFAULT_ANCHORS };
  };
  const choose = (
    g: { s: ESignAnchorSource; l: AnchorLists },
    text: string | null,
    roles: readonly SignerRole[],
  ) => pickAnchors({ text, side: companySideOf(g.s.deal, g.s.direction), roles, lists: g.l });

  const pick = async (
    who: PackWho,
    id: string,
    roles: readonly SignerRole[],
    bytes?: Uint8Array,
  ): Promise<AnchorPick> => {
    const g = await load(who, id);
    const t = await textOf(who, g.s, d.pdf, bytes);
    return choose(g, t === BUSY ? null : t, roles);
  };

  return {
    pick,
    lists: async (who: PackWho): Promise<ESignAnchorsOut> =>
      listsOut(await d.uow.tenant(who, (r) => r.anchor.lists())),
    async saveLists(who: PackWho, b: ESignAnchorsIn): Promise<ESignAnchorsOut> {
      const l = { a: cleanList(b.a), b: cleanList(b.b) };
      if (l.a.length === 0 || l.b.length === 0) throw new ESignFail("VALIDATION", "anchors");
      await d.uow.tenant(who, (r) => r.anchor.saveLists(l, who.userId));
      return listsOut(l);
    },
    /** Xem trước cho hộp Gửi ký với người ký mặc định (công ty + đối tác). */
    async preview(who: PackWho, id: string): Promise<{ placement: ESignPlacement }> {
      const g = await load(who, id);
      const t = await textOf(who, g.s, d.previewPdf);
      if (t === BUSY) return { placement: "unknown" };
      return { placement: choose(g, t, ["company", "partner"]).mode };
    },
  };
}
export type ESignAnchors = ReturnType<typeof esignAnchors>;

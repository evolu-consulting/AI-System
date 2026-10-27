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
  pdf: Pick<PdfConverter, "toText"> | null;
};

export function esignAnchors(d: ESignAnchorDeps) {
  const listsOut = (l: AnchorLists | null): ESignAnchorsOut => ({
    ...(l ?? DEFAULT_ANCHORS),
    is_default: l === null,
  });

  /** Chữ của tệp: `source_text` ⇒ lớp chữ PDF (bytes có sẵn hoặc tải FileBox); lỗi/scan ⇒ null. */
  const textOf = async (who: PackWho, s: ESignAnchorSource, bytes?: Uint8Array) => {
    if (s.text?.trim()) return s.text;
    if (!d.pdf || s.file?.mime !== "application/pdf") return null;
    try {
      const b = bytes ?? (d.files ? await d.files(s.file.org).getContent(s.file.fileId) : null);
      if (!b) return null;
      const r = await d.pdf.toText(b, { tenantId: who.tenantId });
      return r.ok ? r.markdown : null;
    } catch {
      return null;
    }
  };

  const pick = async (
    who: PackWho,
    id: string,
    roles: readonly SignerRole[],
    bytes?: Uint8Array,
  ): Promise<AnchorPick> => {
    const got = await d.uow.tenant(who, async (r) => ({
      s: await r.anchor.source(id),
      l: await r.anchor.lists(),
    }));
    if (!got.s) throw new ESignFail("NOT_FOUND", "contract");
    return pickAnchors({
      text: await textOf(who, got.s, bytes),
      side: companySideOf(got.s.deal, got.s.direction),
      roles,
      lists: got.l ?? DEFAULT_ANCHORS,
    });
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
      const p = await pick(who, id, ["company", "partner"]);
      return { placement: p.mode };
    },
  };
}
export type ESignAnchors = ReturnType<typeof esignAnchors>;

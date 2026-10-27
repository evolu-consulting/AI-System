// CR-101 DOC-model · R30 API · R42 API · R43: gắn chứng từ có sẵn vào HĐ nguyên tắc (nhiều id) và gỡ liên kết. Lớp 2 — không SQL.
// MỘT tx `PackUow`: đọc HĐ NT + các con (một câu) → luật `attachVerdict` (lỗi sớm, đúng mã) → ghi cả chuỗi phiên bản của mỗi con
// (một câu; trigger 0055 kiểm lại trong DB). Số câu cố định, không phụ thuộc số id.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { attachVerdict } from "../domain/doc-types.rules";

export type FrameRow = {
  root_id: string;
  doc_type: string;
  partner_key: string | null;
  direction: string | null;
};
export type ChildRow = {
  id: string;
  root_id: string;
  doc_type: string;
  kind: string;
  partner_key: string | null;
  direction: string | null;
};
export type DocFrameRepo = {
  /** HĐ NT `frameId` (bản bất kỳ; thông tin đối tác theo bản hiện hành của chuỗi) + các con thấy được — MỘT câu. */
  load(
    frameId: string,
    ids: readonly string[],
  ): Promise<{ frame: FrameRow | null; children: ChildRow[] }>;
  /** Đặt `frame_root_id` cho mọi bản của các chuỗi `roots` + event `frame_attached` — MỘT câu; trả id chuỗi đã đổi. */
  attach(frameRoot: string, roots: readonly string[], userId: string): Promise<string[]>;
  /** Gỡ liên kết cả chuỗi của `id` + event `frame_detached`; null = không thấy. */
  detach(id: string, userId: string): Promise<{ detached: boolean } | null>;
};
export type DocFrameRepos = { docFrame: DocFrameRepo };

export class DocFrameFail extends Error {
  constructor(readonly code: "NOT_FOUND" | "FRAME_INVALID" | "FRAME_PARTNER_MISMATCH") {
    super(code);
  }
}

/** R43 · luật `attachVerdict` cho một con; con không gắn được vào chính chuỗi HĐ NT. */
function checkChild(frame: FrameRow, c: ChildRow): void {
  const v = attachVerdict(
    { docType: frame.doc_type, partnerKey: frame.partner_key, direction: frame.direction },
    { docType: c.doc_type, kind: c.kind, partnerKey: c.partner_key, direction: c.direction },
  );
  if (v === "partner_mismatch") throw new DocFrameFail("FRAME_PARTNER_MISMATCH");
  if (v !== "ok" || c.root_id === frame.root_id) throw new DocFrameFail("FRAME_INVALID");
}

export function docFrameUsecases(d: { uow: PackUow<DocFrameRepos> }) {
  return {
    attach: (who: PackWho, frameId: string, ids: readonly string[]) =>
      d.uow.tenant(who, async (r) => {
        const uniq = [...new Set(ids)];
        const { frame, children } = await r.docFrame.load(frameId, uniq);
        if (!frame) throw new DocFrameFail("NOT_FOUND");
        if (children.length !== uniq.length) throw new DocFrameFail("FRAME_INVALID");
        for (const c of children) checkChild(frame, c);
        const roots = [...new Set(children.map((c) => c.root_id))];
        await r.docFrame.attach(frame.root_id, roots, who.userId);
        return { frame_root_id: frame.root_id, attached: uniq };
      }),
    detach: (who: PackWho, id: string) =>
      d.uow.tenant(who, async (r) => {
        const out = await r.docFrame.detach(id, who.userId);
        if (!out) throw new DocFrameFail("NOT_FOUND");
        return { id, detached: out.detached };
      }),
  };
}
export type DocFrameUsecases = ReturnType<typeof docFrameUsecases>;

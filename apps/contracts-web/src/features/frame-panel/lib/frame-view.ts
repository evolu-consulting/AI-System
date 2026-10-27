// CR-101 DOC-ui-frame · R44–R47: luật hiển thị thuần của HĐ nguyên tắc — % hạn mức, giai đoạn, diễn biến xen chứng từ con + mốc, lọc loại
// mốc cho HĐ NT, ứng viên "Gắn chứng từ có sẵn", câu lỗi 422/409 bằng tiếng Việt. Không I/O.
import type { ContractDoc, ContractListResponse, FrameChild, Milestone } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { KINDS, type MilestoneKind } from "~/features/contract-milestones/lib/timeline";

type T = (key: string) => string;

/** Mã lỗi DOC-model / DOC-deals ⇒ khoá i18n (`contracts.docframe.err.*`). */
const ERR_KEY: Record<string, string> = {
  FRAME_INVALID: "contracts.docframe.err.invalid",
  FRAME_PARTNER_MISMATCH: "contracts.docframe.err.partnerMismatch",
  FRAME_MILESTONE_KIND: "contracts.docframe.err.milestoneKind",
  FRAME_HAS_CHILDREN: "contracts.docframe.err.hasChildren",
  PROMOTE_NEEDS_FILE: "contracts.docframe.err.needsFile",
  PROMOTE_NEEDS_NUMBER: "contracts.docframe.err.needsNumber",
  NOT_A_DEAL: "contracts.docframe.err.notADeal",
  CONTRACT_LOCKED: "contracts.lock.errLocked",
  FORBIDDEN: "contracts.docframe.err.forbidden",
};

/** Khoá i18n của mã lỗi (null nếu không phải mã chứng từ). Không hiện thông điệp thô của máy chủ. */
export const docErrorKey = (code: string | undefined): string | null =>
  (code && ERR_KEY[code]) || null;

/** Câu lỗi cho người dùng: mã biết ⇒ câu riêng; mất mạng ⇒ câu mạng; còn lại ⇒ câu chung. */
export function docErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    const k = docErrorKey(e.code as string);
    if (k) return t(k);
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
    if (e.status === 409) return t("contracts.errors.conflict");
  }
  return t("contracts.errors.unknown");
}

export type Usage = {
  hasLimit: boolean;
  /** % đã dùng (có thể > 100). */
  pct: number | null;
  /** Độ rộng thanh 0–100. */
  bar: number;
  over: boolean;
};

/** % hạn mức: không đặt hạn mức ⇒ không có thanh; > 100% ⇒ `over` (cảnh báo, không chặn). */
export function usageOf(
  summary: { credit_pct: number | null } | null,
  creditLimit: number | null,
): Usage {
  const pct = summary?.credit_pct ?? null;
  const hasLimit = creditLimit !== null && creditLimit > 0 && pct !== null;
  return {
    hasLimit,
    pct: hasLimit ? pct : null,
    bar: hasLimit && pct !== null ? Math.max(0, Math.min(100, pct)) : 0,
    over: hasLimit && pct !== null && pct > 100,
  };
}

/** Số con có ngày ngoài hiệu lực HĐ NT (R45). */
export const outsideCount = (children: readonly FrameChild[]): number =>
  children.filter((c) => c.outside_frame).length;

export type DiaryNode =
  | { type: "milestone"; date: string; m: Milestone }
  | { type: "child"; date: string | null; child: FrameChild };

/**
 * R47 · diễn biến HĐ NT: mốc (bỏ mốc đã huỷ) xen chứng từ con theo ngày (mốc: hạn; con: ngày bắt đầu), tăng dần. Cùng ngày: mốc trước
 * con; con không có ngày ở cuối.
 */
export function mergeDiary(
  milestones: readonly Milestone[],
  children: readonly FrameChild[],
): DiaryNode[] {
  const ms = milestones
    .filter((m) => m.status !== "cancelled")
    .map((m): DiaryNode => ({ type: "milestone", date: m.due_date, m }));
  const ch = children.map((child): DiaryNode => ({ type: "child", date: child.start_date, child }));
  const rank = (n: DiaryNode) => (n.type === "milestone" ? 0 : 1);
  return [...ms, ...ch].sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date.localeCompare(b.date);
    }
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.type === "milestone" && b.type === "milestone" ? a.m.seq - b.m.seq : 0;
  });
}

/** R44 · HĐ NT chỉ có mốc "Nhắc gia hạn" + "Khác"; chứng từ khác đủ 7 loại. */
export const FRAME_KINDS: readonly MilestoneKind[] = ["renewal", "other"];
export const kindsFor = (docType: string | undefined): readonly MilestoneKind[] =>
  docType === "framework" ? FRAME_KINDS : KINDS;

/**
 * Ứng viên "Gắn chứng từ có sẵn" từ danh sách (`nest=1`): HĐ kinh tế / giao dịch, không phải HĐ NT, không phải phụ lục, không phải
 * chính nó, chưa gắn HĐ NT này, chưa bị từ chối. Cùng đối tác + hướng do máy chủ kiểm (422 `FRAME_PARTNER_MISMATCH`).
 */
export function attachCandidates(
  list: Pick<ContractListResponse, "items" | "docs">,
  frameId: string,
  attachedIds: readonly string[],
): ContractListResponse["items"] {
  const docs = list.docs ?? [];
  const attached = new Set(attachedIds);
  return list.items.filter((it, i) => {
    const d = docs[i];
    if (it.id === frameId || attached.has(it.id)) return false;
    if (it.kind !== "contract" || it.status === "rejected") return false;
    return !d || d.doc_type !== "framework";
  });
}

export type DocTypeKey = ContractDoc["doc_type"];
/** Đầu trang: nhãn loại + liên kết "thuộc HĐ nguyên tắc" (không quyền xem ⇒ nhãn riêng). */
export type FrameLink =
  | { kind: "link"; id: string; title: string; number: string | null }
  | { kind: "restricted" }
  | null;
export function frameLinkOf(doc: ContractDoc | undefined): FrameLink {
  const f = doc?.frame;
  if (!f) return null;
  if ("restricted" in f) return { kind: "restricted" };
  return { kind: "link", id: f.id, title: f.title, number: f.number };
}

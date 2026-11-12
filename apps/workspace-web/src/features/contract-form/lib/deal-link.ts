// CR-127 · U6 · M12 · spec §4.1/§8: ô «Thuộc hợp đồng nào?» của giao dịch tạo từ Sản phẩm & Giá. Có HĐ đã duyệt xong còn hiệu lực với đối tác ⇒
// BẮT BUỘC chọn một mốc mở hoặc «Không theo hợp đồng» (kèm lý do); chọn mốc ⇒ ghi thẳng vào mốc, cần bằng chứng (ý kiến + chữ ký hoặc tệp). Thuần.

import type { EvidenceInput } from "@ai/contracts/chat";
import type { ContractDeal, DealLink } from "@ai/contracts/pack-contracts";
import {
  type EvidenceDraft,
  type EvidenceRule,
  evidenceBody,
  evidenceIssue,
} from "~/platform/flow/lib/evidence";

export type LinkChoice =
  | { kind: "unset" }
  | { kind: "milestone"; obligationId: string }
  | { kind: "none"; reason: string };
export const UNSET_LINK: LinkChoice = { kind: "unset" };

/** Bằng chứng khi ghi nhận vào mốc: ý kiến + (chữ ký hoặc tệp). */
export const LINK_EVIDENCE_RULE: EvidenceRule = {
  mode: "opinion_plus",
  signature: true,
  files: true,
};

/** Hướng HĐ cần tra mốc: Bán ⇒ HĐ bán, Mua ⇒ HĐ mua; Giới thiệu không có mốc giao/nhận ⇒ không gắn. */
export const linkDirection = (deal: ContractDeal): "sale" | "purchase" | null =>
  deal === "sell" ? "sale" : deal === "buy" ? "purchase" : null;

export type LinkIssue = "required" | "reason" | "evidence";

/** Thiếu gì trước khi lưu (khớp mã server: LINK_REQUIRED · LINK_REASON_REQUIRED · EVIDENCE_REQUIRED); `openCount` = số mốc mở của đối tác. */
export function linkIssue(c: LinkChoice, openCount: number, ev: EvidenceDraft): LinkIssue | null {
  if (openCount === 0) return null;
  if (c.kind === "unset") return "required";
  if (c.kind === "none") return c.reason.trim() ? null : "reason";
  return evidenceIssue(ev, LINK_EVIDENCE_RULE) ? "evidence" : null;
}

/** Phần thân `POST /contracts/deals` cho lựa chọn; chưa chọn ⇒ không gửi gì (đối tác không có HĐ mở). */
export function linkBody(
  c: LinkChoice,
  ev: EvidenceDraft,
): { link?: DealLink; evidence?: EvidenceInput } {
  if (c.kind === "milestone")
    return {
      link: { obligation_id: c.obligationId },
      evidence: evidenceBody(ev, LINK_EVIDENCE_RULE),
    };
  if (c.kind === "none") return { link: { none: { reason: c.reason.trim() } } };
  return {};
}

/** Phần còn lại của mốc dạng số ("650") ⇒ số; mốc tiền/không số ⇒ null. */
export const remainingNum = (r: string | null): number | null => {
  const n = r == null ? NaN : Number(r);
  return Number.isFinite(n) ? n : null;
};

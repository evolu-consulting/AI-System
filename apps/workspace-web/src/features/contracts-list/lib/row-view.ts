// V2-F · HD-03 · mockup `renderCList`: suy các ô của một dòng danh sách từ `ContractListRow` + `progress` (V2-A) — đối tác theo loại HĐ,
// loại (Mua/Bán/Giới thiệu), hiệu lực, giai đoạn + bước hiện tại (đỏ khi quá hạn). Thuần.
import type {
  ContractDeal,
  ContractListRow,
  ContractProgress,
  ContractStage,
  ContractStep,
} from "@ai/contracts/pack-contracts";
import { DEAL_TONE, STAGE_TONE } from "~/features/contract-form/lib/deal";

export { DEAL_TONE, STAGE_TONE };

/** Trạng thái chưa vào theo dõi: danh sách hiện nhãn trạng thái thay vì giai đoạn (chưa có mốc). */
const UNTRACKED = new Set(["needs_review", "extracting", "extract_failed", "rejected"]);

export function dealOfRow(
  r: Pick<ContractListRow, "direction">,
  p: ContractProgress | undefined,
): ContractDeal | null {
  if (p?.deal) return p.deal;
  if (r.direction === "purchase") return "buy";
  if (r.direction === "sale") return "sell";
  return null;
}

/** Đối tác = bên bán khi mình MUA, bên mua khi mình BÁN / GIỚI THIỆU (V2-A). */
export const partnerOfRow = (
  r: Pick<ContractListRow, "seller" | "buyer">,
  deal: ContractDeal | null,
): string | null => (deal === "buy" ? r.seller : (r.buyer ?? r.seller));

/** CR-125 · SA H4 · mã bước → khoá i18n (hub trả mã, web dịch; không so sánh với chữ tiếng Việt). */
export const stepKey = (step: ContractStep): string =>
  step.code === "waiting_sign" && step.who
    ? "contracts.list.step.waiting_sign_who"
    : `contracts.list.step.${step.code}`;

/**
 * CR-123 · u10b: HĐ đã vào theo dõi (đang hiệu lực…) mà lượt duyệt kết thúc "Đã duyệt" ⇒ "Đã duyệt · <trạng thái HĐ>". Mã kết cục lấy
 * từ `step_label` của API (cùng helper `stepLabelOf` với thẻ duyệt); mã khác (đang chờ…) không ghép — HĐ đang hiệu lực không chờ ai.
 */
export const approvedLabel = (
  step: ContractStep | null | undefined,
  approvedText: string,
  statusText: string,
): string | null => (step?.code === "approved" ? `${approvedText} · ${statusText}` : null);

export type StageView =
  | { kind: "status" }
  | { kind: "stage"; stage: ContractStage; overdue: boolean; step: string | null };

export function stageView(
  r: Pick<ContractListRow, "status">,
  p: ContractProgress | undefined,
): StageView {
  if (!p || UNTRACKED.has(r.status)) return { kind: "status" };
  const overdue = p.stage === "in_progress" && !!p.next?.overdue;
  return {
    kind: "stage",
    stage: p.stage,
    overdue,
    step: p.stage === "in_progress" ? (p.next?.title ?? null) : null,
  };
}

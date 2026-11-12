// V2-F · HD-03 · mockup `renderCList`: suy các ô của một dòng danh sách từ `ContractListRow` + `progress` (V2-A) — đối tác theo loại HĐ,
// loại (Mua/Bán/Giới thiệu), hiệu lực, giai đoạn + bước hiện tại (đỏ khi quá hạn). Thuần.
import type {
  ContractDeal,
  ContractListRow,
  ContractProgress,
  ContractStep,
} from "@ai/contracts/pack-contracts";
import { DEAL_TONE } from "~/features/contract-form/lib/deal";
import { type EffectChipView, effectChipOf } from "~/features/contract-shared/lib/status-view";

export { DEAL_TONE };

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

/** Số ngày từ hôm nay tới `end` (lịch địa phương); thiếu ngày ⇒ null. Chỉ dùng cho chip "Hết hạn sau N ngày". */
export function daysLeftOf(end: string | null, now: Date = new Date()): number | null {
  if (!end) return null;
  const [y, m, d] = end.split("-").map(Number) as [number, number, number];
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

export type StatusView = {
  effect: EffectChipView | null;
  held: boolean;
  /** AI đọc văn bản (không phải trạng thái): đang đọc / chưa đọc được; xong hoặc không có ⇒ null. */
  extract: "reading" | "failed" | null;
};

/** CR-127 · U6: ô Trạng thái = chip 4 trạng thái + chip hiệu lực (chỉ HĐ đã duyệt xong, BR-07) + tạm khoá + trạng thái đọc của AI. */
export function statusView(
  r: Pick<ContractListRow, "status" | "effect" | "hold" | "extract_state">,
  daysLeft: number | null,
): StatusView {
  return {
    effect: effectChipOf(r, daysLeft),
    held: !!r.hold,
    extract:
      r.extract_state === "reading" ? "reading" : r.extract_state === "failed" ? "failed" : null,
  };
}

export type WaitingView = {
  step: string | null;
  who: string | null;
  due: string | null;
  overdue: boolean;
};

/** "Đang chờ": HĐ không có lượt duyệt mở ⇒ null; quá hạn khi `due_at` đã qua `now`. */
export function waitingView(
  w: ContractListRow["waiting"],
  now: Date = new Date(),
): WaitingView | null {
  if (!w) return null;
  const due = w.due_at ? w.due_at.slice(0, 10) : null;
  return {
    step: w.step,
    who: w.who,
    due,
    overdue: !!w.due_at && Date.parse(w.due_at) < now.getTime(),
  };
}

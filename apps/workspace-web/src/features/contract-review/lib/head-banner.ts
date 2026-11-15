// CR-127 · U5 · BR-35…40 · M10: dữ liệu cho MỘT băng lý do ở đầu trang — ai trả lại / từ chối, nói gì, lúc nào; đang chờ bước nào. Thuần.
import type { ContractDetail } from "@ai/contracts/pack-contracts";

export type LastDecision = {
  action: "return" | "reject" | "withdraw";
  /** Người quyết (nội bộ). Quyết của ĐỐI TÁC ⇒ `viaPartner` và băng hiện tên công ty đối tác, không lộ người bên kia. */
  by: string | null;
  at: string;
  note: string | null;
  viaPartner: boolean;
  /** Tên đối tác lúc gửi (`partner_sent.to`); vắng ⇒ web dùng tên bên đối ứng của HĐ. */
  partnerName: string | null;
};

type Ev = ContractDetail["events"][number];
type Role = "source" | "outcome";
type Kind = { action: LastDecision["action"]; role: Role; partner: boolean };

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Sự kiện nào là quyết định: NGUỒN (người/đối tác quyết, có thể kèm lý do) hay KẾT CỤC (HĐ đổi trạng thái, không kèm lý do). */
function kindOf(e: Ev): Kind | null {
  const d = e.data as { action?: unknown; outcome?: unknown };
  if (e.type === "stage_decided" && (d.action === "return" || d.action === "reject"))
    return { action: d.action, role: "source", partner: false };
  if (e.type === "partner_replied" && (d.outcome === "returned" || d.outcome === "declined"))
    return {
      action: d.outcome === "returned" ? "return" : "reject",
      role: "source",
      partner: true,
    };
  if (e.type === "withdrawn") return { action: "withdraw", role: "source", partner: false };
  if (e.type === "returned") return { action: "return", role: "outcome", partner: false };
  if (e.type === "rejected") return { action: "reject", role: "outcome", partner: false };
  return null;
}

const noteOf = (e: Ev): string | null => {
  const d = e.data as { feedback?: unknown; note?: unknown; reason?: unknown };
  return text(d.feedback) ?? text(d.note) ?? text(d.reason);
};

/** Nguồn của quyết định: chính sự kiện (nếu là nguồn) hoặc sự kiện nguồn cùng loại đứng ngay trước nó, dừng khi gặp kết cục của vòng trước. */
function sourceOf(sorted: Ev[], at: number, top: Kind): { e: Ev; k: Kind } | null {
  for (const e of sorted.slice(at + 1)) {
    const k = kindOf(e);
    if (!k) continue;
    if (k.role === "outcome") return null;
    if (k.action === top.action) return { e, k };
  }
  return null;
}

/**
 * Quyết định gần nhất làm HĐ về DRAFT / REJECT (sự kiện mới nhất trước). `events` do hub trả mới → cũ hoặc cũ → mới: tự tìm theo `at`.
 * Lý do (G1, mỗi nguồn một chỗ): người duyệt nhập ⇒ trong sự kiện; ý kiến đi theo bằng chứng (`opinion_plus`) bị lược khỏi sự kiện (BR-26) ⇒
 * hub đưa sẵn `returnReason` đã lọc quyền; đối tác ⇒ `partner_replied.reason`. `returnReason` chỉ dùng cho quyết định NỘI BỘ.
 */
export function lastDecision(
  events: ContractDetail["events"],
  returnReason: string | null = null,
): LastDecision | null {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const at = sorted.findIndex((e) => kindOf(e) !== null);
  const top = sorted[at];
  const k = top ? kindOf(top) : null;
  if (!top || !k) return null;
  const src = k.role === "source" ? { e: top, k } : sourceOf(sorted, at, k);
  const partner = src?.k.partner === true;
  const sent = partner ? sorted.find((e) => e.type === "partner_sent") : undefined;
  return {
    action: k.action,
    by: partner ? null : top.actor_user_id,
    at: top.at,
    note:
      (src ? noteOf(src.e) : noteOf(top)) ??
      (partner || k.action === "withdraw" ? null : text(returnReason)),
    viaPartner: partner,
    partnerName: text((sent?.data as { to?: unknown } | undefined)?.to),
  };
}

/** "Còn N giờ" tới hạn bước đang chờ; null khi không có hạn / đã quá hạn ⇒ `{ over: true }`. */
export function hoursLeft(
  dueAt: string | null | undefined,
  now = Date.now(),
): { hours: number; over: boolean } | null {
  if (!dueAt) return null;
  const ms = Date.parse(dueAt) - now;
  if (Number.isNaN(ms)) return null;
  return { hours: Math.max(0, Math.ceil(ms / 3_600_000)), over: ms < 0 };
}

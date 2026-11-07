// CR-124 · q4 · FLOW4-FR-14 · thẻ 3 dòng (trạng thái · lý do · bước kế) cho hộp «Hợp đồng đối tác gửi» (bên nhận) và vòng gửi (bên gửi).
// Thuần (không React): trả KHOÁ i18n + tham số để test; không lộ id nội bộ, không tên người duyệt của bên kia (spec §9, câu 4).
export type InboxItem = {
  contract_id: string;
  title: string;
  sender_name: string;
  sender_verified: boolean;
  round: number;
  prev_reason: string | null;
  importance: string;
  expires_at: string;
  status: string;
  reason: string | null;
};
export type Invite = {
  from_tenant: string;
  from_name: string;
  from_verified: boolean;
  held: number;
};
export type Round = {
  mailbox_id: string;
  round: number;
  channel: string;
  to_name: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  /** `held` = chờ công ty nhận đồng ý kết nối (không bao giờ hiện «bị chặn»). */
  mb_status?: string | null;
  expires_at?: string | null;
};
export type Line = { key: string; vars?: Record<string, string | number> };
export type Card = { tone: "wait" | "ok" | "bad"; lines: [Line, Line, Line] };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });

/** Bên NHẬN. pending ⇒ «Chờ bạn xác nhận · mở để Đồng ý / Trả lại / Từ chối»; xong ⇒ «Đã báo công ty gửi». */
export function inboxCard(i: InboxItem): Card {
  const who = {
    sender: i.sender_name,
    level: `contracts.partner.level.${i.importance}`,
    round: i.round,
  };
  if (i.status === "pending")
    return {
      tone: "wait",
      lines: [
        { key: "contracts.partner.in.pending", vars: { until: day(i.expires_at) } },
        i.round > 1 && i.prev_reason
          ? { key: "contracts.partner.in.reasonRound", vars: { ...who, prev: i.prev_reason } }
          : { key: "contracts.partner.in.reason", vars: who },
        { key: "contracts.partner.in.nextOpen" },
      ],
    };
  const done = i.status === "confirmed";
  return {
    tone: done ? "ok" : "bad",
    lines: [
      { key: `contracts.partner.in.${i.status}` },
      i.reason
        ? { key: "contracts.partner.in.yourReason", vars: { reason: i.reason } }
        : { key: "contracts.partner.in.reason", vars: who },
      { key: "contracts.partner.in.nextNone", vars: { sender: i.sender_name } },
    ],
  };
}

/** Bên GỬI (một vòng). Giữ chờ kết nối ⇒ «Đang chờ công ty nhận đồng ý kết nối» (hết hạn ⇒ «Đối tác không nhận — hết hạn»; KHÔNG BAO GIỜ hiện «bị chặn»);
 *  open ⇒ chờ + «Ghi nhận kết quả khi có trả lời»; đã trả lời ⇒ kết quả + lý do + bước kế (sửa rồi gửi lại). */
const isPast = (iso: string | null | undefined, now: Date): boolean =>
  iso != null && Date.parse(iso) <= now.getTime();

type RoundVars = Record<string, string | number>;
const L = (key: string, vars?: RoundVars): Line => (vars ? { key, vars } : { key });

function heldCard(r: Round, to: RoundVars, now: Date): Card {
  const p = "contracts.partner.out.";
  if (isPast(r.expires_at, now))
    return {
      tone: "bad",
      lines: [L(`${p}heldExpired`, to), L(`${p}heldExpiredWhy`), L(`${p}nextFix`)],
    };
  return { tone: "wait", lines: [L(`${p}held`, to), L(`${p}heldWhy`, to), L(`${p}heldNext`)] };
}

function openCard(r: Round, to: RoundVars, now: Date): Card {
  const p = "contracts.partner.out.";
  const expired = isPast(r.expires_at, now);
  const first = expired ? `${p}expired` : r.channel === "manual" ? `${p}waitManual` : `${p}wait`;
  return {
    tone: expired ? "bad" : "wait",
    lines: [L(first, to), L(`${p}via`, to), L(`${p}nextRecord`)],
  };
}

function doneCard(r: Round, to: RoundVars): Card {
  const p = "contracts.partner.out.";
  const ok = r.status === "confirmed";
  const next = ok ? "nextOk" : r.status === "returned" ? "nextFix" : "nextStop";
  return {
    tone: ok ? "ok" : "bad",
    lines: [
      L(`${p}${r.status}`, to),
      r.reason ? L(`${p}reason`, { reason: r.reason }) : L(`${p}via`, to),
      L(`${p}${next}`),
    ],
  };
}

export function roundCard(r: Round, now: Date = new Date()): Card {
  const to = {
    to: r.to_name ?? "đối tác",
    round: r.round,
    since: day(r.created_at),
    channel: `contracts.partner.channel.${r.channel}`,
  };
  if (r.status !== "open") return doneCard(r, to);
  return r.mb_status === "held" ? heldCard(r, to, now) : openCard(r, to, now);
}

export const needsReason = (outcome: string): boolean => outcome !== "confirmed";

/** Hợp lệ để ghi nhận: Trả lại / Từ chối cần lý do; luôn cần tên người trả lời; kênh thủ công cần ≥ 1 bằng chứng. */
export function recordIssue(f: {
  outcome: string;
  reason: string;
  byName: string;
  evidence: readonly string[];
  channel: string;
}): "reason" | "byName" | "evidence" | null {
  if (f.byName.trim() === "") return "byName";
  if (needsReason(f.outcome) && f.reason.trim() === "") return "reason";
  if (f.channel === "manual" && f.evidence.filter((x) => x.trim()).length === 0) return "evidence";
  return null;
}

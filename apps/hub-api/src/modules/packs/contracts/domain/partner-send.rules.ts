// CR-124 · q3 · FLOW4-FR-08/15/17 · luật thuần (lớp 1) của bước «Gửi đối tác xác nhận»: chọn kênh, mức quan trọng, bản chia sẻ, kết quả → trạng thái
// HĐ nhận. Không I/O. Tên khoá khớp `packages/contracts/src/modules/contracts/partner-send/config.ts` (domain không import `@ai/contracts`, ADR-0023).

import type { ContractEv } from "./contract-state.rules";

export const PARTNER_FIELD_KEYS = [
  "total_value",
  "start_date",
  "end_date",
  "payment_term",
] as const;
export type PartnerChannel = "platform" | "email" | "manual";
export type PartnerOutcome = "confirmed" | "returned" | "declined";
export type Importance = "normal" | "important" | "critical";
export type ImportanceHint = Importance | "auto";

export const REPLY_DAYS_DEFAULT = 7;
export const REPLY_DAYS_MAX = 30;

/** Ngưỡng mặc định theo giá trị HĐ (spec §6: Quan trọng ≥ 500 triệu, Rất quan trọng ≥ 2 tỷ). q4 cho công ty nhận đặt ngưỡng riêng. */
export const IMPORTANCE_THRESHOLDS = { important: 500_000_000, critical: 2_000_000_000 } as const;

const RANK: Record<Importance, number> = { normal: 0, important: 1, critical: 2 };

export const importanceByValue = (
  value: number | null,
  t: { important: number; critical: number } = IMPORTANCE_THRESHOLDS,
): Importance => {
  if (value === null || !Number.isFinite(value)) return "normal";
  if (value >= t.critical) return "critical";
  return value >= t.important ? "important" : "normal";
};

/** Mức cuối = max(gợi ý của bên gửi, mức theo luật bên nhận). Gợi ý `auto`/lạ ⇒ chỉ theo luật bên nhận (không tin mức tự khai). */
export function finalImportance(hint: unknown, byRule: Importance): Importance {
  const h = hint === "normal" || hint === "important" || hint === "critical" ? hint : "normal";
  return RANK[h] > RANK[byRule] ? h : byRule;
}

export type RouteInfo = { toTenant: string; name: string; verified: boolean; link: string };
export type ChannelPlan =
  | {
      channel: "platform";
      toTenant: string;
      /** CR-126 · email người nhận ĐÃ CHỌN: lưu ở dòng hộp thư + gửi MỘT thư báo (vào app để trả lời). null ⇒ không có thư báo. */
      toEmail: string | null;
      toName: string;
      why: null;
      held: boolean;
    }
  | { channel: "email"; toTenant: null; toEmail: string; toName: string | null; why: string | null }
  | { channel: "manual"; toTenant: null; toEmail: null; toName: string | null; why: string | null };

/**
 * FLOW4-FR-15 · tự chọn kênh: công ty nhận trên nền tảng + đã nối ⇒ nền tảng; còn lại có email ⇒ email; không email ⇒ thủ công.
 * `why` = vì sao không dùng nền tảng (chưa nối / bị chặn / không trên nền tảng) để hiện trên thẻ.
 */
export function planChannel(
  route: RouteInfo | null,
  email: string | null,
  name: string | null,
): ChannelPlan {
  // q4 · chưa nối nhưng công ty nhận trên nền tảng ⇒ vẫn kênh nền tảng: lần gửi được GIỮ tới khi B chấp nhận nối (hub 0122).
  if (route && route.link !== "blocked") {
    return {
      channel: "platform",
      toTenant: route.toTenant,
      toEmail: email,
      toName: route.name,
      why: null,
      held: route.link !== "accepted",
    };
  }
  const why =
    route === null ? "not_on_platform" : route.link === "blocked" ? "link_blocked" : "link_pending";
  const toName = route?.name ?? name;
  if (email) return { channel: "email", toTenant: null, toEmail: email, toName, why };
  return { channel: "manual", toTenant: null, toEmail: null, toName, why };
}

/** Lần gửi trước (nếu Trả lại và cùng đối tượng nhận) ⇒ lần gửi lại có `prev_id` (FR-17); khác đối tượng ⇒ lần gửi mới vòng 1. */
export function prevMailboxOf(
  last: { mailboxId: string; status: string; toKey: string | null } | null,
  toKey: string,
): string | null {
  return last && last.status === "returned" && last.toKey === toKey ? last.mailboxId : null;
}

/** Nền tảng có email ⇒ khoá gồm cả email (hàm `hub.partner_send` đòi lần gửi trước cùng `to_tenant` VÀ `to_email`); đổi người nhận ⇒ vòng 1 mới. */
export const toKeyOf = (p: ChannelPlan): string =>
  p.channel === "platform"
    ? p.toEmail
      ? `t:${p.toTenant}|e:${p.toEmail.toLowerCase()}`
      : `t:${p.toTenant}`
    : p.channel === "email"
      ? `e:${p.toEmail.toLowerCase()}`
      : "m:";

export const replyDaysOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= REPLY_DAYS_MAX ? n : REPLY_DAYS_DEFAULT;
};

/** Bản chia sẻ: CHỈ trường A chọn (`fields[k].value`) + lời nhắn + gợi ý mức. Không id/người dùng/lịch sử của A. */
export function buildPayload(i: {
  title: string;
  message: string | undefined;
  hint: ImportanceHint | undefined;
  sendFields: readonly string[];
  fields: Readonly<Record<string, unknown>>;
  signTogether?: SignTogether | null | undefined;
}): Record<string, unknown> {
  const shared: Record<string, unknown> = {};
  for (const k of i.sendFields) {
    const v = (i.fields[k] as { value?: unknown } | undefined)?.value;
    if (v !== undefined && v !== null && v !== "") shared[k] = v;
  }
  return {
    title: i.title.slice(0, 200),
    ...(i.message ? { message: i.message.slice(0, 1000) } : {}),
    importance_hint: i.hint ?? "auto",
    fields: shared,
    ...(i.signTogether
      ? {
          sign_together: {
            reason: i.signTogether.reason,
            accept_h: i.signTogether.acceptH,
            sign_h: i.signTogether.signH,
          },
        }
      : {}),
  };
}

/** CR-127 · P2 · BR-60: đề nghị ký cùng lúc kèm lần gửi (ghi vào `payload.sign_together` + phiên ký chung). Tên khoá khớp `PartnerSendConfigSchema`. */
export type SignTogether = { reason: string; acceptH: number; signH: number };
export const SIGN_TOGETHER_DEFAULTS = { acceptH: 2, signH: 4 } as const;

/**
 * Cấu hình node ⇒ đề nghị ký cùng lúc. Không bật ⇒ `null` (gửi thường). Bật mà thiếu lý do ⇒ `SIGN_TOGETHER_REASON_REQUIRED` (BR-60: lý do bắt buộc —
 * lỗi nghiệp vụ, không gửi). Hạn mặc định 2 giờ trả lời / 4 giờ ký.
 */
export function signTogetherPlan(cfg: {
  sign_together?: boolean | undefined;
  sign_reason?: string | undefined;
  accept_h?: number | undefined;
  sign_h?: number | undefined;
}): SignTogether | null {
  if (!cfg.sign_together) return null;
  const reason = (cfg.sign_reason ?? "").trim();
  if (!reason) throw new Error("SIGN_TOGETHER_REASON_REQUIRED");
  return {
    reason: reason.slice(0, 500),
    acceptH: cfg.accept_h ?? SIGN_TOGETHER_DEFAULTS.acceptH,
    signH: cfg.sign_h ?? SIGN_TOGETHER_DEFAULTS.signH,
  };
}

/** Giá trị HĐ (số) của bản chia sẻ — null khi A không gửi kèm. */
export function sharedValueOf(shared: Readonly<Record<string, unknown>>): number | null {
  const v = shared.total_value;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Sự kiện cổng `contract-state` theo câu trả lời của flow nhận (spec §3 #5/#10/#6): Đồng ý ⇒ DONE; Trả lại ⇒ DRAFT "Chờ đối tác gửi bản sửa"; Từ chối ⇒ REJECT. */
export const INBOX_CONTRACT_EV: Record<PartnerOutcome, ContractEv> = {
  confirmed: "flow_approved",
  returned: "partner_returned",
  declined: "flow_rejected",
};

export const isPartnerOutcome = (o: string): o is PartnerOutcome =>
  o === "confirmed" || o === "returned" || o === "declined";

/** Lý do dự phòng khi kết thúc flow nhận không mang lý do (Trả lại/Từ chối bắt buộc lý do ở `hub.partner_reply`). TODO(q4): lấy lý do người duyệt. */
export const FALLBACK_REASON: Record<Exclude<PartnerOutcome, "confirmed">, string> = {
  returned: "Bên nhận trả lại theo quy trình nhận hợp đồng.",
  declined: "Bên nhận từ chối theo quy trình nhận hợp đồng.",
};

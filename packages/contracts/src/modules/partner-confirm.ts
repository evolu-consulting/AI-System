// CR-125 · UX-S7 (H7) · MỘT luật THUẦN "công ty đã dùng được Đối tác xác nhận hợp đồng chưa": danh sách điều kiện, mỗi điều kiện có
// trạng thái, AI phải làm (who) và nút làm hộ (fix) nếu nền tảng làm được. Dùng chung cho Quản trị nền tảng (Ứng dụng của công ty) và
// Cài đặt của Sổ Hợp Tác (công ty chỉ xem). Phần dữ liệu: admin-api đọc `AdminPart`, Hub đọc `HubPart` (admin-api gộp lại).
// Fix dùng đúng đường có sẵn: cấp tính năng (entitlement), Tạo nhóm theo gợi ý (template-fixes); thiếu quy trình Nhận HĐ ⇒ mở trang Quy trình
// (CR-127: không còn mẫu Thư viện để gán — CR-138b).

/** Phần admin-api đọc được (hồ sơ công ty + entitlement). */
export type PartnerAdminPart = {
  /** Công ty đã có Sổ Hợp Tác (`contracts-read`). */
  contracts_app: boolean;
  /** Tính năng `contracts-partner-confirm` đã cấp. */
  feature: boolean;
  legal_name: boolean;
  tax_code: boolean;
  /** "Cho phép tìm thấy" (danh bạ công ty). */
  listed: boolean;
};

/** Phần Hub đọc được (kênh, flow, nhóm). */
export type PartnerHubPart = {
  /** Kênh hộp thư liên công ty bật trên hệ thống (HUB_PARTNER_MAILBOX). */
  channel: boolean;
  /** Có flow nhận (sự kiện `contract.received`, bật, không điều kiện). */
  receive_flow: boolean;
  /** Có flow đang bật chứa bước «Gửi đối tác xác nhận». */
  send_flow: boolean;
  /** Nhóm duyệt mà flow nhận trỏ tới: có chưa, bao nhiêu thành viên. `key` = mã nhóm của MẪU (để tạo theo gợi ý). */
  groups: { key: string; exists: boolean; members: number }[];
};

export const PARTNER_ITEM_KEYS = [
  "app",
  "feature",
  "channel",
  "profile",
  "listed",
  "receive_flow",
  "groups",
  "send_flow",
] as const;
export type PartnerItemKey = (typeof PARTNER_ITEM_KEYS)[number];
/** Ai làm: nền tảng (quản trị nền tảng) hay công ty (quản trị công ty). */
export type PartnerWho = "platform" | "company";
/** Nút "Làm bước này" mà platform dùng (company chỉ xem). `open-*` = chuyển tới màn làm việc đó. */
export type PartnerFix = "grant-feature" | "create-group" | "open-profile" | "open-flows";
/** Cần cho: gửi HĐ cho đối tác, nhận HĐ từ đối tác, hay cả hai. */
export type PartnerNeed = "send" | "receive" | "both";

export type PartnerItem = {
  key: PartnerItemKey;
  /** ok = xong; todo = còn thiếu; unknown = chưa đọc được (Hub không trả lời). */
  state: "ok" | "todo" | "unknown";
  who: PartnerWho;
  need: PartnerNeed;
  fix?: PartnerFix;
  /** Biến cho câu chữ (web dịch theo `key` + `state`): nhóm thiếu, tên tính năng… */
  params?: { groups?: string[]; empty?: string[] };
};

export type PartnerChecklist = {
  /** Tính năng đã bật cho công ty (công tắc). */
  on: boolean;
  /** Đủ điều kiện nhận / gửi (mọi điều kiện cần cho hướng đó đã xong). */
  ready_to_receive: boolean;
  ready_to_send: boolean;
  items: PartnerItem[];
};

const item = (
  key: PartnerItemKey,
  ok: boolean | null,
  who: PartnerWho,
  ...[need, extra = {}]: [need: PartnerNeed, extra?: Pick<PartnerItem, "fix" | "params">]
): PartnerItem => ({
  key,
  state: ok === null ? "unknown" : ok ? "ok" : "todo",
  who,
  need,
  ...(ok === true ? {} : extra),
});

/** Gộp hai phần thành danh sách điều kiện. `hub` null = Hub không trả lời (mục của Hub hiện "chưa đọc được", không chặn ngầm). */
export function partnerChecklist(
  admin: PartnerAdminPart,
  hub: PartnerHubPart | null,
): PartnerChecklist {
  const h = hub;
  const missingGroups = h ? h.groups.filter((g) => !g.exists).map((g) => g.key) : [];
  const emptyGroups = h
    ? h.groups.filter((g) => g.exists && g.members === 0).map((g) => g.key)
    : [];
  const groupsOk = h ? missingGroups.length === 0 && emptyGroups.length === 0 : null;
  const items: PartnerItem[] = [
    item("app", admin.contracts_app, "platform", "both"),
    item("feature", admin.feature, "platform", "both", { fix: "grant-feature" }),
    item("channel", h ? h.channel : null, "platform", "both"),
    item("profile", admin.legal_name && admin.tax_code, "platform", "both", {
      fix: "open-profile",
    }),
    item("listed", admin.listed, "company", "receive"),
    // CR-127 Z7 / CR-138b: không còn mẫu để gán ⇒ «Tạo quy trình Nhận HĐ ở trang Quy trình» (nút mở trang Quy trình)
    item("receive_flow", h ? h.receive_flow : null, "company", "receive", { fix: "open-flows" }),
    item("groups", groupsOk, missingGroups.length ? "platform" : "company", "receive", {
      ...(missingGroups.length ? { fix: "create-group" as const } : {}),
      params: { groups: missingGroups, empty: emptyGroups },
    }),
    item("send_flow", h ? h.send_flow : null, "company", "send", { fix: "open-flows" }),
  ];
  const ready = (need: "send" | "receive") =>
    admin.feature && items.every((i) => i.state === "ok" || (i.need !== "both" && i.need !== need));
  return {
    on: admin.feature,
    ready_to_receive: ready("receive"),
    ready_to_send: ready("send"),
    items,
  };
}

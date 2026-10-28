// CR-102 · C5 · ngữ cảnh người xem + công ty đối tác + hồ sơ + cài đặt (`GET /pack/community/me` ...).
import { z } from "zod";

export const COMMUNITY_ROLES = ["host_admin", "host_member", "partner"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];
export const PARTNER_LABELS = ["supplier", "buyer"] as const;
export type PartnerLabel = (typeof PARTNER_LABELS)[number];
export const PARTNER_LABEL_TEXT: Record<PartnerLabel, string> = {
  supplier: "Nhà cung cấp",
  buyer: "Người mua",
};

/** Màu chủ đạo (mockup: Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam). */
export const COMMUNITY_ACCENTS = ["indigo", "blue", "teal", "green", "orange"] as const;
export type CommunityAccent = (typeof COMMUNITY_ACCENTS)[number];

export const CommunityViewerSchema = z.strictObject({
  userId: z.string(),
  name: z.string(),
  role: z.enum(COMMUNITY_ROLES),
  orgId: z.string(),
  orgName: z.string(),
  /** Nhãn công ty đối tác (`both` = cả hai); rỗng với chủ quản. */
  labels: z.array(z.enum(PARTNER_LABELS)),
  /** Nhóm hàng quan tâm của công ty (đối tác). */
  cats: z.array(z.string()),
});
export type CommunityViewer = z.infer<typeof CommunityViewerSchema>;
export const isHost = (v: Pick<CommunityViewer, "role">): boolean => v.role !== "partner";

/** Công ty đối tác (chủ quản: danh sách đầy đủ, dùng chọn người xem + lọc người đăng; đối tác: chỉ công ty mình). */
export const PartnerOrgSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  labels: z.array(z.enum(PARTNER_LABELS)),
  cats: z.array(z.string()),
  area: z.string().optional(),
  /** Chủ quản: đã vô hiệu ("đối tác đã rời"). */
  left: z.boolean().optional(),
  /** C3 · chỉ chủ quản: khoá đối tác SHT đã liên kết (Câu 2). */
  partyKey: z.string().optional(),
});
export type PartnerOrg = z.infer<typeof PartnerOrgSchema>;

/** C3 · `PUT /pack/community/partners/:orgId` — chỉ Admin chủ quản (HT-82): nhãn, nhóm hàng, khu vực, liên kết đối tác SHT. */
export const PartnerUpdateInputSchema = z.strictObject({
  labels: z.array(z.enum(PARTNER_LABELS)).max(2),
  cats: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  area: z.string().trim().max(100).default(""),
  /** null = gỡ liên kết. */
  partyKey: z.string().trim().min(1).max(200).nullable().default(null),
});
export type PartnerUpdateInput = z.input<typeof PartnerUpdateInputSchema>;

export const ProfileSchema = z.strictObject({
  org: PartnerOrgSchema.extend({ isHost: z.boolean(), blurb: z.string().default("") }),
  stats: z.strictObject({
    active: z.number().int(),
    archived: z.number().int(),
    comments: z.number().int(),
    /** Số bạn bè — chỉ chủ quản xem hồ sơ chủ quản. */
    friends: z.number().int().optional(),
  }),
  /** Mở Sổ Hợp Tác (contracts-web): chỉ chủ quản, hồ sơ công ty đối tác không có (HT-75/76). */
  shtUrl: z.string().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const NOTIFY_KINDS = [
  "comment",
  "reply",
  "newSell",
  "newBuy",
  "matchBuy",
  "priceEdited",
  "expiring",
  "digest",
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const CommunitySettingsSchema = z.strictObject({
  accent: z.enum(COMMUNITY_ACCENTS),
  notify: z.record(z.enum(NOTIFY_KINDS), z.boolean()),
});
export type CommunitySettings = z.infer<typeof CommunitySettingsSchema>;
export const DEFAULT_SETTINGS: CommunitySettings = {
  accent: "indigo",
  notify: {
    comment: true,
    reply: true,
    newSell: true,
    newBuy: true,
    matchBuy: true,
    priceEdited: true,
    expiring: true,
    digest: false,
  },
};

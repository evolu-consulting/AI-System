// CR-102b · ADR-0031 · hai cổng community KHAI (kiểu thuần, KHÔNG import gói contracts): `SupplierQuoteWriter` (ghi duy nhất vào SP & Giá)
// và `HostBookReader` (đọc sổ chủ quản). Cùng hình với bản contracts cung cấp; `packs/community-wire.mount.ts` tiêm usecase thật,
// typecheck ở đó bắt lệch hợp đồng.
import type {
  CompanyBrandRow,
  HostBookOut,
  HostHintIn,
  HostPriceOut,
  HostProductOut,
  QuoteCompare,
  QuoteInput,
  QuoteWarning,
} from "../domain/quote.types";

export type {
  CompanyBrandRow,
  HostBookOut,
  HostHintIn,
  HostPriceOut,
  HostProductOut,
  QuoteCompare,
  QuoteInput,
  QuoteProduct,
  QuoteWarning,
} from "../domain/quote.types";
export type QuoteCaller = { tenantId: string; userId: string; kind: "internal" | "external" };

export type QuotePreview = { compare: QuoteCompare; warnings: QuoteWarning[]; replaces: string[] };
export type QuoteSaved = QuotePreview & {
  price_id: string;
  product_id: string;
  product_created: boolean;
  supplier_party_key: string;
  supplier_created: boolean;
};

export type SupplierQuoteWriter = {
  preview(by: QuoteCaller, q: QuoteInput): Promise<QuotePreview>;
  save(by: QuoteCaller, q: QuoteInput): Promise<QuoteSaved>;
};

/** Lỗi cổng ghi (cùng `kind` với `SaveQuoteFail` của contracts; so khớp theo `kind`, không `instanceof`). */
export const QUOTE_FAIL_KINDS = ["forbidden", "not_found", "invalid", "exists"] as const;

export type HostCaller = {
  tenantId: string;
  userId: string;
  userKind?: "internal" | "external";
  extOrgId?: string | null;
  kind?: "internal" | "external";
};
export type HostBookReader = {
  read(
    who: HostCaller,
    q: { hints: readonly HostHintIn[]; partyKeys?: readonly string[] },
  ): Promise<HostBookOut>;
  /**
   * C8 → C9 (`matchBuy`): user nội bộ có quyền đọc gói contracts khi tenant đang có hàng (tồn > 0) khớp tên `product`. MỘT tx sổ,
   * số câu cố định + MỘT câu quyền theo tập — không vòng theo người.
   */
  stockHolders(tenantId: string, product: string): Promise<readonly string[]>;
};

/**
 * CR-110 · ADR-0031: đọc brand công ty CHỦ QUẢN của `tenantId` (MỘT câu, đúng 4 cột). Dùng cho mọi account trong tenant, kể cả
 * đối tác — người gọi (community) đã kiểm quyền vào gói; `tenantId` lấy từ token, không bao giờ từ tham số request.
 */
export type CompanyBrandReader = {
  brand(tenantId: string): Promise<CompanyBrandRow | null>;
};

/** CR-110 · COM-FR-43 (I3): người gọi có quyền đọc gói contracts? Từ cache cấu hình (0 SQL khi nóng). User ngoài ⇒ false. */
export type ContractsCapReader = {
  contracts(who: Pick<HostCaller, "tenantId" | "userId" | "userKind">): Promise<boolean>;
};

/** CR-118 §11.1 · kho byte tệp bài (FileBox org `t_<tenant>`, tiêm ở `packs/community-wire.mount.ts`). Vắng ⇒ `POST/GET /files` 503. */
export type CommunityBlobs = {
  put(
    tenantId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ fileId: string; versionId: string | null }>;
  /** null = không còn ở kho. */
  get(tenantId: string, fileId: string): Promise<Uint8Array | null>;
  /** Xoá byte (idempotent: đã không còn ⇒ xong). Kho lỗi ⇒ NÉM (upload hoàn tác bỏ qua; vòng dọn tệp giữ hàng làm lại). */
  drop(tenantId: string, fileId: string): Promise<void>;
};

/** CR-118 · cr118-files-quota: giữ MỘT lượt tải tệp bài TRƯỚC khi đọc thân (trần lượt/phút theo người + lượt/ngày theo tenant +
 * toàn hệ thống). Vượt ⇒ ném 429 `UPLOAD_QUOTA` {scope: "user"|"tenant"|"global", limit, resets_at}; bộ đếm lỗi/vắng ⇒ 503
 * `UPLOAD_QUOTA_UNAVAILABLE`. Trả hàm hoàn lượt (gọi khi tải thất bại sau đó: 413/415/kho/DB). */
export type CommunityUploadGate = (who: {
  tenantId: string;
  userId: string;
}) => Promise<() => Promise<void>>;

/**
 * CR-130 pha 2 · ADR-0043 · cổng GHI duy nhất community → SHT cho đối tác: duyệt yêu cầu tham gia ⇒ liên kết tài khoản công ty
 * (`extOrgId`) với một đối tác SHT (vai `partner_roles` + hồ sơ `partner_profiles`). Chạy TRONG tx của người gọi (cùng lượt duyệt ⇒
 * rollback cùng nhau). Chỉ người nội bộ/việc nền: `by.kind = "external"` ⇒ ném (route đã kiểm quyền duyệt, đây là chốt thứ hai).
 * Idempotent: gọi lại không đổi gì (vai thêm, không gỡ). `tx` mờ với community; contracts đổi role gói trong chính tx đó.
 */
export type PartnerLinkInput = {
  extOrgId: string;
  /** Tên công ty (đã nhập ở form xin tham gia) — khoá đối tác `name:<fold>` khi chưa có đối tác trùng tên ở SHT. */
  name: string;
  roles: readonly ("supplier" | "customer")[];
  /** Đối tác SHT do ADMIN chọn tường minh khi duyệt (`party_key`); vắng/null ⇒ luôn tạo đối tác MỚI (không tự khớp theo tên). */
  partyKey?: string | null;
};

/** Lỗi cổng ghi (so khớp theo `kind`): `already_linked` (đối tác/tài khoản đã gắn nơi khác), `not_found` (khoá đối tác không có), `org_forbidden` (công ty không thuộc tenant). */
export const PARTNER_LINK_FAIL_KINDS = ["already_linked", "not_found", "org_forbidden"] as const;
export type PartnerLinkFailKind = (typeof PARTNER_LINK_FAIL_KINDS)[number];
export type PartnerLinker = {
  linkInTx(
    tx: unknown,
    by: { tenantId: string; kind: "internal" | "external" },
    i: PartnerLinkInput,
  ): Promise<{ partyKey: string; linked: boolean }>;
};

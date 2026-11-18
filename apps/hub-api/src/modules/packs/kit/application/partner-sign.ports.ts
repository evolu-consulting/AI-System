// CR-182 · đợt 2 · cổng giữa trang công khai «Đối tác ký qua link» (hub `partners/`, không JWT) và gói Hợp đồng. Hub lo hạn mức/CSRF/hash token/kiểm PNG;
// gói lo dữ liệu (tra link bằng hàm DEFINER theo BĂM token, tệp, in chữ ký). Lớp 2 — chỉ kiểu; không I/O.
import type {
  PartnerDeclineBody,
  PartnerQuickMethod,
  PartnerSignBody,
  PartnerSignSaveOut,
  PartnerSignViewOut,
} from "@ai/contracts/pack-contracts";

export type SignLinkFail = {
  ok: false;
  /** 404 không có link/tệp · 410 hết hạn/thu hồi · 409 đã ký/từ chối · 403 ô không phải của đối tác · 422 dấu sai · 400 thiếu chữ ký nhanh. */
  status: 400 | 403 | 404 | 409 | 410 | 422;
  code: string;
};
export type SignLinkResult<T> = { ok: true; data: T } | SignLinkFail;

/** `th` = SHA-256 hex của token (token rõ KHÔNG qua cổng). */
export type PartnerSignPublicPort = {
  view(th: string, o: { audit: boolean }): Promise<SignLinkResult<PartnerSignViewOut>>;
  /** Nội dung PDF của tệp được gửi: `versionId` null ⇒ bản mới nhất chưa huỷ (không có thì bản gốc). */
  content(
    th: string,
    fileId: string,
    versionId: string | null,
  ): Promise<SignLinkResult<{ bytes: Uint8Array; name: string }>>;
  /** PNG đã được hub kiểm (magic + IHDR + cỡ). */
  quick(
    th: string,
    b: { method: PartnerQuickMethod; png: Uint8Array },
  ): Promise<SignLinkResult<{ saved: true }>>;
  sign(th: string, b: PartnerSignBody): Promise<SignLinkResult<PartnerSignSaveOut>>;
  decline(th: string, b: PartnerDeclineBody): Promise<SignLinkResult<{ declined: true }>>;
};
export type PartnerSignPortRegistry = {
  set(p: PartnerSignPublicPort): void;
  get(): PartnerSignPublicPort | undefined;
};

/** Thư gửi đối tác — transport email chung của thông báo do hub gắn (gói không import module hub). Vắng ⇒ `HUB_NOTIFY_MODE=off`. */
export type PartnerSignMail = {
  idempotencyKey: string;
  tenantId: string;
  to: string;
  toName: string;
  subject: string;
  text: string;
  html?: string;
};
export type PartnerSignMailer = {
  sendBatch(
    msgs: readonly PartnerSignMail[],
  ): Promise<({ ok: true } | { ok: false; permanent: boolean; code: string; skip?: boolean })[]>;
};
export type PartnerSignMailerRegistry = {
  set(m: PartnerSignMailer | null, baseUrl?: string): void;
  get(): PartnerSignMailer | null;
  /** Gốc URL công khai dựng link `<APP_URL>/ky/<token>` (`HUB_NOTIFY_BASE_URL`). */
  baseUrl(): string;
};

// cf-esign-docusign · cổng ký số: nhà cung cấp (`ESignProvider` — DocuSign thật / giả), repo trong tx RLS của tenant, tệp FileBox,
// thông tin user hiện tại. Lớp 2 — chỉ kiểu.
import type { ESignStatus } from "../domain/esign.rules";

export type ESignRecipient = {
  /** esign-multi · vai (trang ký: Bên A = công ty, Bên B… = đối tác). */
  role: "company" | "partner";
  name: string;
  email: string;
  /** Thứ tự ký (1, 2, … — tuần tự). */
  order: number;
  /** Có ⇒ ký nhúng trong app (recipient view), DocuSign không gửi email. */
  clientUserId: string | null;
};

export type ESignEnvelopeInfo = {
  status: string;
  reason: string | null;
  completedAt: string | null;
  recipients: { email: string; status: string | null; signedAt: string | null }[];
};

/** Kết quả kiểm webhook của nhà cung cấp: chỉ envelopeId được tin (đã xác thực). */
export type ESignWebhookCheck = { ok: true; envelopeId: string | null } | { ok: false };

/** Port nhà cung cấp ký số — TRUNG LẬP (DocuSign, ký thử `selfsign`, CA Việt Nam sau này). Lỗi ⇒ `ESignProviderError`
 *  (không mang token/khoá/thân). */
export type ESignProvider = {
  /** Khoá lưu ở cột `provider` + đoạn route webhook (`/esign/webhook/:provider`). */
  key: string;
  /** Ký thử (demo) — không có giá trị pháp lý; UI hiện nhãn rõ. */
  demo: boolean;
  /** Xác thực + đọc webhook (vắng ⇒ nhà cung cấp không có webhook ⇒ 404). */
  webhook?: (raw: Uint8Array, header: (name: string) => string | undefined) => ESignWebhookCheck;
  createEnvelope(i: {
    subject: string;
    /** esign-multi · tên + số HĐ cho trang ký. */
    title: string;
    number: string | null;
    document: { name: string; bytes: Uint8Array };
    signers: ESignRecipient[];
    /** esign-anchor · cụm trong văn bản HĐ cho từng người ký (cùng thứ tự `signers`) ⇒ ô ký ngay dưới cụm, không nối trang ký;
     *  vắng/null ⇒ trang ký cuối. Nhà cung cấp không hỗ trợ ⇒ bỏ qua. */
    anchors?: string[] | null;
  }): Promise<{ envelopeId: string; placement?: "text" | "page" }>;
  getEnvelope(envelopeId: string): Promise<ESignEnvelopeInfo>;
  recipientView(
    envelopeId: string,
    r: { name: string; email: string; clientUserId: string },
    returnUrl: string,
  ): Promise<string>;
  /** PDF đã ký; null ⇒ nhà cung cấp không giữ tài liệu (ký thử) ⇒ dùng bản PDF gốc của HĐ. */
  combinedPdf(envelopeId: string): Promise<Uint8Array | null>;
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
};

export class ESignProviderError extends Error {
  constructor(readonly detail: string) {
    super(`esign-provider: ${detail}`);
    this.name = "ESignProviderError";
  }
}

export type StoredSigner = {
  role: "company" | "partner";
  name: string;
  email: string;
  order: number;
  client_user_id: string | null;
  status: string | null;
  signed_at: string | null;
  /** esign-multi · nhà cung cấp/chứng thư người này dùng khi ký (phong bì loại "ca"); vắng ở hàng cũ ⇒ null. */
  provider?: string | null;
  certificate_ref?: string | null;
};

/** esign-multi · registry nhà cung cấp: danh sách theo env (cả không khả dụng) + adapter của nhà cung cấp KHẢ DỤNG. */
export type ESignProviderEntry = {
  key: string;
  label: string;
  kind: "envelope" | "ca";
  legal: boolean;
  available: boolean;
};
export type ESignRegistry = {
  entries: ESignProviderEntry[];
  get(key: string): ESignProvider | null;
};

export type EnvelopeRow = {
  id: string;
  contractId: string;
  provider: string;
  envelopeId: string;
  status: ESignStatus;
  signers: StoredSigner[];
  reason: string | null;
  signedFileId: string | null;
  completedAt: string | null;
  createdAt: string;
  sentBy: string;
};

export type ContractForSign = {
  id: string;
  title: string;
  number: string | null;
  locked: boolean;
  file: { org: string; fileId: string; mime: string; name: string } | null;
  partner: { name: string | null; email: string | null } | null;
};

export type SignedFileNew = {
  id: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  sizeBytes: number;
  createdBy: string;
};

export type ESignRepo = {
  /** Cờ bật + nhà cung cấp mặc định đã chọn (chưa kiểm khả dụng). */
  settings(): Promise<{ enabled: boolean; defaultProvider: string | null }>;
  /** Lưu trường có mặt (vắng = giữ) + audit before/after. */
  saveSettings(p: { enabled?: boolean; defaultProvider?: string }, actor: string): Promise<void>;
  /** HĐ thấy được (RLS + M1) hoặc null. */
  contract(id: string): Promise<ContractForSign | null>;
  latest(contractId: string): Promise<EnvelopeRow | null>;
  byEnvelope(envelopeId: string): Promise<EnvelopeRow | null>;
  /** Trùng envelope đang chờ của HĐ (index một phần) ⇒ false. */
  insert(r: {
    contractId: string;
    provider: string;
    envelopeId: string;
    signers: StoredSigner[];
    sentBy: string;
  }): Promise<boolean>;
  update(
    envelopeId: string,
    p: {
      status: ESignStatus;
      reason: string | null;
      completedAt: string | null;
      signers: StoredSigner[];
    },
  ): Promise<void>;
  /** Ghi hàng `files` + gắn vào envelope nếu chưa có bản đã ký (khoá hàng) ⇒ true; đã có ⇒ false. */
  attachSigned(envelopeId: string, f: SignedFileNew): Promise<boolean>;
  signedFile(contractId: string): Promise<{ org: string; fileId: string } | null>;
};

/** FileBox theo org của tenant (phần cần). */
export type ESignFiles = (org: string) => {
  getContent(fileId: string): Promise<Uint8Array | null>;
  postFile(name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  getLink(fileId: string): Promise<string | null>;
  deleteFile(fileId: string): Promise<unknown>;
};

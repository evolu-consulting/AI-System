// CR-181 · lát s2 · cổng của use case chữ ký nội bộ (lớp 2 — chỉ kiểu; adapter `signature.store.ts` / `company-admin.ts` cài, mount tiêm).
import type { SignatureKind, SignatureMethod, SignatureSettings } from "@ai/contracts/signature";
import type {
  ChangeGrantResult,
  ChangeGrantState,
  ChangeRequestRow,
  ProfileParts,
  SignatureCreated,
  SignatureHistoryRow,
  SignatureRecord,
  SignatureSettingsRecord,
} from "../domain/signature.types";

/** Người thao tác (từ JWT). */
export type Actor = {
  userId: string;
  tenantId: string;
  role: string;
  userKind?: "internal" | "external";
};

/** Kho chữ ký trong MỘT transaction scope người dùng (khớp `signaturesRepo(tx)`). */
export type SignatureRepoPort = {
  getActive(kind: SignatureKind): Promise<SignatureRecord | null>;
  getActiveAll(): Promise<{ main: SignatureRecord | null; initials: SignatureRecord | null }>;
  listHistory(kind: SignatureKind | null, limit?: number): Promise<SignatureHistoryRow[]>;
  create(
    kind: SignatureKind,
    method: SignatureMethod,
    png: Uint8Array,
    caption?: string | null,
  ): Promise<SignatureCreated>;
  /** CR-188 · họ tên · chức vụ · phòng ban của tôi (điền sẵn «Dòng dưới chữ ký»). */
  profile(): Promise<ProfileParts>;
  getSettings(): Promise<SignatureSettingsRecord>;
  putSettingsAsAdmin(s: SignatureSettings): Promise<SignatureSettingsRecord>;
  getChangeState(): Promise<ChangeGrantState | null>;
  requestChange(): Promise<ChangeGrantResult>;
  /** Lỗi DB đã đổi sang `SignatureError` (tự cấp ⇒ SIGNATURE_SELF_GRANT, người ngoài công ty ⇒ SIGNATURE_USER_NOT_FOUND). */
  grantChangeAsAdmin(userId: string): Promise<ChangeGrantResult>;
  consumeGrant(): Promise<boolean>;
  listChangeRequestsAsAdmin(limit?: number): Promise<ChangeRequestRow[]>;
};

export type AuditAction =
  | "signature_created"
  | "signature_settings_changed"
  | "signature_change_requested"
  | "signature_change_granted";
export type AuditEntry = {
  action: AuditAction;
  entityId: string | null;
  entityName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
};
export type BellRow = {
  user_id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  dedup_key: string;
};

/** Mọi thứ use case cần trong một tx (cùng tx ⇒ lỗi ⇒ rollback cả audit/chuông). */
export type SignatureTx = {
  repo: SignatureRepoPort;
  /** Tên hiển thị + username của người thao tác (một câu). */
  who(): Promise<{ username: string | null; name: string }>;
  /** Khoá advisory theo (tenant, người, loại) — cùng khoá với `hub.sig_create` — để kiểm quyền đổi + tạo là một bước nguyên tử. */
  lockSignature(kind: SignatureKind): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
  /** MỘT lệnh cho cả lô; rỗng ⇒ không làm gì. */
  bell(rows: readonly BellRow[]): Promise<void>;
};

export type SignatureStore = {
  run<T>(actor: Actor, fn: (tx: SignatureTx) => Promise<T>): Promise<T>;
};

export type CompanyAdminPort = {
  isAdmin(actor: Actor): Promise<boolean>;
  /** Quản trị còn dùng được của công ty, trừ `exceptUserId`. */
  recipients(tenantId: string, exceptUserId: string): Promise<string[]>;
};

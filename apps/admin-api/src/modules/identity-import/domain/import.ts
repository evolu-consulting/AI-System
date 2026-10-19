// N5-FR-01…07 · kiểu domain chuyển user mgmt-app (spec N5 §2, §7). Thuần — chỉ built-in.

export type PackRole = "owner" | "editor" | "viewer";
export type AdminRole = "tenant_admin" | "member";
export type Locale = "vi" | "en";

export type OrgIn = { id: string; name: string; tenantKey: string | null };
export type UserIn = {
  email: string;
  name: string;
  orgId: string | null;
  orgRole: string | null;
  /** Hash thô từ mgmt-app — chỉ đi vào câu chèn, KHÔNG vào log/báo cáo/audit (N5-NFR-02). */
  passwordHash: string | null;
  locale: Locale;
  /** M1b · `manager_email` của mgmt-app (người quản lý trực tiếp, cùng org); null/rỗng ⇒ không đặt. */
  managerEmail?: string | null;
};

export type IssueCode =
  | "BAD_ROW"
  | "DUP_ORG"
  | "DUPLICATE_KEY"
  | "ORG_KEY_TAKEN"
  | "TENANT_INACTIVE"
  | "ORG_MISMATCH"
  | "PACK_REVOKED"
  | "INVALID_EMAIL"
  | "DUPLICATE_EMAIL"
  | "NO_ORG"
  | "UNKNOWN_ORG"
  | "ORG_FAILED"
  | "BAD_ROLE"
  | "USERNAME_TAKEN"
  | "USER_CONFLICT"
  | "ROLE_CONFLICT"
  | "ROLE_MISSING"
  | "GROUP_MISSING"
  | "BATCH_FAILED"
  | "MANAGER_UNKNOWN"
  | "MANAGER_CYCLE";
export type Issue = { kind: "org" | "user" | "manager"; ref: string; code: IssueCode };

/** M1b · user của một tenant cho luật quản lý: `key` = email thường (hoặc `#<id>` khi không email); `managerKey` = quản lý
 *  hiện có (DB). `id` null ⇒ user sẽ được tạo (dry-run). */
export type OrgUser = { key: string; id: string | null; managerKey: string | null };
export type ManagerWant = { email: string; managerEmail: string };
export type ManagerPlan = {
  sets: { userKey: string; managerKey: string }[];
  /** User đã có quản lý (đặt tay/lần chạy trước) ⇒ không đè (L2). */
  existing: number;
  issues: Issue[];
};
export type ManagerCounts = { read: number; set: number; existing: number; errors: number };

/** Tenant đã có; `mgmtSource` + `mgmtOrgId` = marker (nguồn, org) do importer ghi (M1); `packRevoked` = có entitlement
 *  `contracts-*` đã bị thu hồi (không bật lại — L2). */
export type ExistingTenant = {
  id: string;
  key: string;
  mgmtSource: string | null;
  mgmtOrgId: string | null;
  active: boolean;
  packRevoked: boolean;
};
export type OrgCreate = { orgId: string; key: string; name: string };
export type OrgPlan = {
  creates: OrgCreate[];
  reuse: { orgId: string; tenantId: string; key: string }[];
  /** Org lỗi (user của nó ⇒ ORG_FAILED); không gồm DUP_ORG (hàng đầu vẫn chạy). */
  failed: string[];
  issues: Issue[];
};

/** User đã có trong tenant (khớp email hoặc username); `roles` = vai gói `contracts` đang thuộc. */
export type ExistingUser = {
  tenantId: string;
  id: string;
  email: string;
  username: string;
  roles: PackRole[];
};
export type PasswordKind = "import" | "reset";
export type UserInsert = {
  tenantId: string;
  email: string;
  username: string;
  displayName: string;
  role: AdminRole;
  packRole: PackRole;
  locale: Locale;
  password: PasswordKind;
  /** Chỉ khác null khi `password = "import"`. */
  importedHash: string | null;
};
/** User đã có KHÔNG bao giờ được gắn Group lại (không hoàn tác việc admin gỡ — review Trung 1 / L2): chỉ đếm hoặc báo. */
export type UserPlan = {
  inserts: UserInsert[];
  existing: number;
  issues: Issue[];
};
/** Trạng thái xuyên lô của một lần chạy (DUP_ORG/DUPLICATE_KEY/DUPLICATE_EMAIL); bên gọi sao chép trước mỗi lần thử tx. */
export type OrgSeen = { ids: Set<string>; keys: Set<string> };

export type Account = {
  tenant_key: string;
  email: string;
  username: string;
  reset_required: boolean;
};
export type Counts = { read: number; created: number; existing: number; errors: number };
export type ImportReport = {
  dry_run: boolean;
  orgs: Counts;
  users: Counts & { hash_imported: number; reset_required: number };
  managers: ManagerCounts;
  issues: Issue[];
  accounts: Account[];
  batches: number;
  ms: number;
};

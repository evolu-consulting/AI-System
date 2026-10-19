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
};

export type IssueCode =
  | "BAD_ROW"
  | "DUP_ORG"
  | "DUPLICATE_KEY"
  | "ORG_KEY_TAKEN"
  | "TENANT_INACTIVE"
  | "INVALID_EMAIL"
  | "DUPLICATE_EMAIL"
  | "NO_ORG"
  | "UNKNOWN_ORG"
  | "ORG_FAILED"
  | "BAD_ROLE"
  | "USERNAME_TAKEN"
  | "USER_CONFLICT"
  | "ROLE_CONFLICT"
  | "BATCH_FAILED";
export type Issue = { kind: "org" | "user"; ref: string; code: IssueCode };

export type ExistingTenant = { id: string; key: string; mgmtOrgId: string | null; active: boolean };
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
export type UserLink = { tenantId: string; userId: string; role: PackRole };
export type UserPlan = {
  inserts: UserInsert[];
  links: UserLink[];
  existing: number;
  issues: Issue[];
};

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
  issues: Issue[];
  accounts: Account[];
  batches: number;
  ms: number;
};

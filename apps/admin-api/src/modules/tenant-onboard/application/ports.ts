// niti-onboard · cổng của use case onboarding (ADR-0023): lớp 2 chỉ biết các cổng này; `tenant-onboard.run.ts` nối với
// configWrite (một tx + audit + NOTIFY), repo SQL, `enablePack` của module packs và AppError.
import type { DeptRow, UserNow } from "../domain/onboard.rules";

export type TenantNow = {
  id: string;
  name: string;
  timezone: string;
  profile: Record<string, unknown>;
  src: string | null;
  org: string | null;
};

export type NewTenant = {
  id: string;
  key: string;
  name: string;
  timezone: string;
  profile: unknown;
  settings: Record<string, unknown>;
};

type Pair = { key: string; email: string };

/** Cổng ghi trong MỘT tx scope platform (mỗi hàm một câu SQL cố định — Luật 4c). */
export type OnboardRepo = {
  actorOk(actorId: string): Promise<boolean>;
  lockTenant(key: string): Promise<TenantNow | null>;
  orgTakenBy(orgId: string, tenantId: string | null): Promise<string | null>;
  insertTenant(t: NewTenant, actorId: string): Promise<boolean>;
  updateTenant(
    id: string,
    set: { name: string; timezone: string; profile: unknown; mark: Record<string, string> },
    actorId: string,
  ): Promise<void>;
  upsertGroups(
    tenantId: string,
    rows: readonly DeptRow[],
    actorId: string,
  ): Promise<{ created: number; renamed: number }>;
  upsertDepartments(tenantId: string, rows: readonly DeptRow[]): Promise<number>;
  addMembers(
    tenantId: string,
    pairs: readonly Pair[],
    actorId: string,
  ): Promise<{ added: number; pending: string[] }>;
  setHeads(tenantId: string, heads: readonly Pair[]): Promise<number>;
};

export type OnboardAudit = {
  op: "create" | "update";
  entityId: string;
  entityName: string;
  tenantId: string;
  summary: Record<string, unknown>;
};

/** Thông báo đổi cấu hình (NOTIFY sau COMMIT) + audit cùng tx. */
export type OnboardSink = {
  changed(entity: "tenant" | "group", tenantId: string): void;
  audit(a: OnboardAudit): void;
};

export type OnboardErrorCode = "FORBIDDEN" | "KEY_TAKEN" | "VALIDATION_ERROR";

/** CR-159 · cổng người dùng/add-on: gọi đúng usecase của admin-api (users.service, org.service, features), không INSERT tay. */
export type UserPorts = {
  /** Một câu SQL, chỉ đọc: người dùng của tenant `key` theo email (tenant chưa có ⇒ rỗng). Ném FORBIDDEN nếu actor không phải platform admin. */
  readUsers(key: string, emails: readonly string[]): Promise<UserNow[]>;
  /** `users.service.createUser` (must_change_password=true); trả id + mật khẩu tạm (CHỈ để `savePassword`). */
  createUser(
    tenantId: string,
    u: { username: string; display_name: string; email: string; role: "tenant_admin" | "member" },
    opts?: { password?: string; mustChange?: boolean },
  ): Promise<{ id: string; tempPassword: string }>;
  updateUser(
    id: string,
    version: number,
    set: { display_name?: string; role?: "tenant_admin" | "member" },
  ): Promise<void>;
  setJobTitle(tenantId: string, userId: string, title: string): Promise<void>;
  /** Ghi `email<TAB>mật khẩu` ngay khi sinh; vắng ⇒ không có `--pw-out`. */
  savePassword?: (email: string, password?: string) => Promise<void>;
  /** CR-159 · mật khẩu chung cho user MỚI (đã kiểm độ dài; không bao giờ ghi log/báo cáo). */
  sharedPassword?: string;
  /** false => user mới `must_change_password=false` (cờ `--no-force-change`); mặc định true. */
  forceChange?: boolean;
  /** Thử ghi nơi chứa mật khẩu (lỗi ⇒ ném); vắng khi không có `--pw-out`. */
  probeSink?: () => Promise<void>;
  /** Chỉ đọc: khoá add-on đã đăng ký chưa. */
  addonKnown(featureKey: string): Promise<boolean>;
  /** Cấp entitlement add-on (idempotent); true ⇒ vừa cấp/cấp lại; khoá chưa đăng ký ⇒ ném. */
  grantAddon(tenantId: string, featureKey: string): Promise<boolean>;
};

export type OnboardPorts = UserPorts & {
  /** Một tx `configWrite`; ném trong `fn` ⇒ rollback. */
  write<T>(fn: (repo: OnboardRepo, sink: OnboardSink) => Promise<T>): Promise<T>;
  /** Bật gói (PK-FR-05, cùng đường admin-web); trả số Group vai. */
  enablePack(tenantId: string, packKey: string): Promise<{ groups: number }>;
  /** Settings mặc định của tenant mới. */
  newTenantSettings: Readonly<Record<string, unknown>>;
  fail(code: OnboardErrorCode, details?: unknown): Error;
};

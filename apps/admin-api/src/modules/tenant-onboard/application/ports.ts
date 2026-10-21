// niti-onboard · cổng của use case onboarding (ADR-0023): lớp 2 chỉ biết các cổng này; `tenant-onboard.run.ts` nối với
// configWrite (một tx + audit + NOTIFY), repo SQL, `enablePack` của module packs và AppError.
import type { DeptRow } from "../domain/onboard.rules";

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

export type OnboardPorts = {
  /** Một tx `configWrite`; ném trong `fn` ⇒ rollback. */
  write<T>(fn: (repo: OnboardRepo, sink: OnboardSink) => Promise<T>): Promise<T>;
  /** Bật gói (PK-FR-05, cùng đường admin-web); trả số Group vai. */
  enablePack(tenantId: string, packKey: string): Promise<{ groups: number }>;
  /** Settings mặc định của tenant mới. */
  newTenantSettings: Readonly<Record<string, unknown>>;
  fail(code: OnboardErrorCode, details?: unknown): Error;
};

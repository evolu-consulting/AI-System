// N5-FR-02, N5-FR-03, N5-FR-07 · port của use case chuyển user (ADR-0023). Mỗi lời gọi lô = MỘT transaction scope platform,
// số câu SQL cố định (N5-NFR-01). `decide` chạy trong tx, giữa câu đọc và câu ghi (đọc–quyết–ghi nhất quán).
import type {
  ExistingTenant,
  ExistingUser,
  OrgCreate,
  OrgPlan,
  PackRole,
  UserInsert,
  UserPlan,
} from "../domain/import";

export type GroupIds = ReadonlyMap<string, Readonly<Record<PackRole, string>>>;

export type OrgBatchResult = {
  plan: OrgPlan;
  /** Tenant thật đã tạo (apply). */
  created: { orgId: string; tenantId: string; key: string }[];
  /** Org mất key do đua (on conflict không trả hàng) ⇒ ORG_KEY_TAKEN. */
  lost: OrgCreate[];
  /** Group vai `contracts` theo tenant (apply; dry-run rỗng). */
  groups: GroupIds;
};

export type UserBatchResult = {
  plan: UserPlan;
  /** Hàng thực sự chèn (apply) — hàng plan không có ở đây ⇒ đụng email/username có sẵn ⇒ USER_CONFLICT. */
  inserted: UserInsert[];
};

/** Lọc leakproof theo (tenant, username ứng viên) — xem `findUsers` (RLS + index). */
export type UserQuery = { tenantIds: string[]; usernames: string[] };

export interface ImportStore {
  /** Actor là platform admin active (tenant active) và gói `contracts` đủ 3 feature. Một tx. */
  preflight(actorId: string): Promise<{ actorOk: boolean; packOk: boolean }>;
  orgBatch(
    apply: boolean,
    q: { orgIds: string[]; keys: string[] },
    decide: (existing: ExistingTenant[]) => OrgPlan,
  ): Promise<OrgBatchResult>;
  userBatch(
    apply: boolean,
    q: UserQuery,
    decide: (existing: ExistingUser[]) => UserPlan,
    groups: GroupIds,
  ): Promise<UserBatchResult>;
}

export type Clock = { now(): number };
/** Lỗi DB thuộc lớp 23 (vi phạm ràng buộc) ⇒ hỏng một lô (R1); khác ⇒ ném tiếp. Trả SQLSTATE hoặc null. */
export type ErrorClass = (err: unknown) => string | null;

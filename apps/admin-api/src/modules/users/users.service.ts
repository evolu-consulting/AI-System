// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-08, ADM-BR-09 · nghiệp vụ users (plan M1 §5 "Users"). Không biết HTTP.
// Mỗi hành động = một withScope theo scope của actor; repo vẫn lọc tenant_id (tenant_admin luôn tenant mình).
import { randomBytes } from "node:crypto";
import {
  BETA_GROUP_KEY,
  GROUP_NAME_MAX,
  type GroupRef,
  type Locale,
  LocalizedTextSchema,
  type User,
  type UserCreateRequest,
  type UserCreateResponse,
  type UserListQuery,
  type UserListResponse,
  type UserUpdateRequest,
} from "@ai/contracts";
import { type Db, type DbScope, hashPassword, type Tx, withScope } from "@ai/db";
import { z } from "zod";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { generateTempPassword } from "../auth/auth.rules";
import { revokeUserSessions } from "../auth/auth.service";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import type { UserRow } from "./users.repo";
import * as repo from "./users.repo";
import {
  type Actor,
  canSeeUser,
  checkLastAdmin,
  checkRoleAssignment,
  checkRoleChange,
  checkSelfAction,
  isAdminRole,
  isEmailRequired,
  type Role,
  type RuleError,
  resolveTenantScope,
  userStatus,
} from "./users.rules";

export type UsersCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: UsersCtx; actor: Actor; scope: DbScope };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const GroupsJson = z.array(
  z.object({ id: z.string(), key: z.string(), name: LocalizedTextSchema(GROUP_NAME_MAX) }),
);

/** jsonb từ subquery (users.repo) → GroupRef[] (validate ở biên đọc DB, CONVENTIONS §5). */
function userGroups(raw: unknown): GroupRef[] {
  return GroupsJson.parse(raw).map((g) => ({ ...g, is_beta: g.key === BETA_GROUP_KEY }));
}

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    tenant_id: u.tenantId,
    tenant_key: u.tenantKey,
    username: u.username,
    display_name: u.displayName,
    email: u.email,
    role: u.role,
    locale: u.locale,
    status: userStatus(u),
    active: u.active,
    locked_by_tenant: u.lockedByTenant,
    locked_until: iso(u.lockedUntil),
    must_change_password: u.mustChangePassword,
    last_login_at: iso(u.lastLoginAt),
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
    version: u.version,
    groups: userGroups(u.groups),
    group_count: u.groupCount,
  };
}

/** Dịch 23505 theo tên constraint (plan §5): username / email trùng trong tenant. */
export function mapUserConflict(err: unknown): never {
  const c = uniqueViolation(err);
  if (c === "users_tenant_username_uq") throw appError("USERNAME_TAKEN");
  if (c === "users_tenant_email_uq") throw appError("EMAIL_TAKEN");
  throw err;
}

const fail = (e: RuleError | null): void => {
  if (e) throw appError(e.code, e.details);
};

async function insertAndRead(tx: Tx, u: repo.NewUser): Promise<User> {
  // Savepoint để lỗi 23505 không làm hỏng transaction ngoài trước khi dịch mã lỗi.
  const id = await tx.transaction((sp) => repo.insertUser(sp, u)).catch(mapUserConflict);
  const row = await repo.findUserRow(tx, u.tenantId, id);
  if (!row) throw new Error("users: không đọc lại được user vừa tạo");
  return toUser(row);
}

/** Tenant mới (FR-60): tenant_admin đầu tiên, `must_change_password=true`, cùng transaction với tenant. */
export function createFirstAdmin(
  tx: Tx,
  input: { tenantId: string; username: string; displayName: string; email: string; locale: Locale },
  passwordHash: string,
): Promise<User> {
  return insertAndRead(tx, { ...input, role: "tenant_admin", passwordHash, lockedByTenant: false });
}

/** Khoá/mở khoá tenant (FR-61, M1-R10): đặt/gỡ `locked_by_tenant` cho user của tenant. */
export function setTenantLockFlags(tx: Tx, tenantId: string, locked: boolean): Promise<void> {
  return repo.setLockedByTenant(tx, tenantId, locked);
}

/** tenant_admin chỉ thấy tenant mình (BR-09); platform không lọc tenant (RLS scope platform vẫn áp). */
const tenantFilter = (a: Actor) => (a.role === "platform_admin" ? null : a.tenantId);

/** Không thấy (tenant khác, id lạ) → 404 cùng body (M1-R13). */
async function mustFindUser(tx: Tx, a: Actor, id: string): Promise<UserRow> {
  const u = await repo.findUserRow(tx, tenantFilter(a), id);
  if (!u || !canSeeUser(a, u)) throw appError("NOT_FOUND");
  return u;
}

async function reread(tx: Tx, u: { tenantId: string; id: string }): Promise<User> {
  const row = await repo.findUserRow(tx, u.tenantId, u.id);
  if (!row) throw appError("NOT_FOUND");
  return toUser(row);
}

/**
 * Mọi thao tác ghi lên user: khoá hàng tenant rồi hàng user bằng FOR NO KEY UPDATE (thứ tự tenant → user như khoá
 * tenant) và trả bản đọc lại sau khi giữ khoá — so `version`, BR-08 đều trên bản này. NO KEY UPDATE (không phải
 * FOR UPDATE) vì INSERT refresh_tokens lấy FOR KEY SHARE trên hàng tenant/user qua FK: FOR UPDATE xung đột với nó
 * và gây deadlock với login/refresh song song (review vòng 2 N1). NO KEY UPDATE vẫn xung đột với nhau và với
 * FOR SHARE nên PATCH/BR-08/createUser vẫn tuần tự.
 */
async function lockTarget(tx: Tx, a: Actor, seen: UserRow): Promise<UserRow> {
  await repo.findTenantBrief(tx, seen.tenantId, { lock: "no key update" });
  if (!(await repo.lockUserRow(tx, seen.tenantId, seen.id))) throw appError("NOT_FOUND");
  return mustFindUser(tx, a, seen.id);
}

/** BR-08 trên bản đã khoá (hai admin khoá nhau cùng lúc → đúng một thành công). */
async function guardLastAdmin(
  tx: Tx,
  u: UserRow,
  change: { active?: boolean; role?: Role },
): Promise<void> {
  if (!isAdminRole(u.role)) return;
  const others = await repo.countOtherActiveAdmins(tx, {
    role: u.role,
    tenantId: u.tenantId,
    excludeId: u.id,
  });
  fail(checkLastAdmin(u, change, others));
}

export async function listUsers(c: Call, q: UserListQuery): Promise<UserListResponse> {
  const r = resolveTenantScope(c.actor, q.tenant_id, "read");
  if ("code" in r) throw appError(r.code);
  const f = { ...q, tenantId: r.tenantId };
  const { rows, counts } = await withScope(c.ctx.db, c.scope, (tx) => repo.listUsers(tx, f));
  return {
    items: rows.map(({ total: _t, ...u }) => toUser(u)),
    total: rows[0]?.total ?? 0,
    counts,
  };
}

export function getUser(c: Call, id: string): Promise<User> {
  return withScope(c.ctx.db, c.scope, async (tx) => toUser(await mustFindUser(tx, c.actor, id)));
}

async function newTempPassword(): Promise<{ pw: string; hash: string }> {
  const pw = generateTempPassword((n) => randomBytes(n));
  return { pw, hash: await hashPassword(pw) };
}

/** FR-04: user mới luôn `must_change_password`; tenant đang khoá → `locked_by_tenant=true` (spec §3). */
export async function createUser(
  c: Call,
  queryTenantId: string | undefined,
  input: UserCreateRequest,
): Promise<UserCreateResponse> {
  const r = resolveTenantScope(c.actor, queryTenantId, "write");
  if ("code" in r) throw appError(r.code);
  const tenantId = r.tenantId as string;
  const temp = await newTempPassword();
  const user = await configWrite(c, "user.save", async (tx, ch) => {
    // FOR SHARE: tenant không bị khoá/mở khoá giữa lúc đọc `active` và lúc chèn user (locked_by_tenant đúng).
    const t = await repo.findTenantBrief(tx, tenantId, { lock: "share" });
    if (!t) throw appError("NOT_FOUND");
    fail(checkRoleAssignment(c.actor, t.key === PLATFORM_TENANT_KEY, input.role));
    const email = input.email ?? null;
    if (isEmailRequired(input.role) && !email) throw appError("EMAIL_REQUIRED");
    ch.changed({ entity: "user", tenantId });
    return insertAndRead(tx, {
      tenantId,
      username: input.username,
      displayName: input.display_name,
      email,
      role: input.role,
      locale: input.locale,
      passwordHash: temp.hash,
      lockedByTenant: !t.active,
    });
  });
  return { user, temp_password: temp.pw };
}

/** Chỉ trường gửi lên và khác giá trị hiện tại (G8: trùng hết → không tăng version). */
function diffUser(u: UserRow, input: UserUpdateRequest): repo.UserSet {
  const set: repo.UserSet = {};
  if (input.display_name !== undefined && input.display_name !== u.displayName) {
    set.displayName = input.display_name;
  }
  if (input.email !== undefined && input.email !== u.email) set.email = input.email;
  if (input.role !== undefined && input.role !== u.role) set.role = input.role;
  if (input.locale !== undefined && input.locale !== u.locale) set.locale = input.locale;
  return set;
}

function checkUpdate(c: Call, u: UserRow, set: repo.UserSet): void {
  if (set.role) {
    fail(checkRoleChange(c.actor, u, set.role));
    fail(checkRoleAssignment(c.actor, u.tenantKey === PLATFORM_TENANT_KEY, set.role));
  }
  const role = set.role ?? u.role;
  const email = set.email !== undefined ? set.email : u.email;
  if (isEmailRequired(role) && !email) throw appError("EMAIL_REQUIRED");
}

/** PATCH theo `version` trên bản đã khoá: lệch → 409 {current, updated_at}; PATCH song song → đúng một thắng. */
export function updateUser(c: Call, id: string, input: UserUpdateRequest): Promise<User> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const u = await lockTarget(tx, c.actor, await mustFindUser(tx, c.actor, id));
    await afterLock(c.ctx.hooks, "user.save", "locked");
    if (u.version !== input.version) {
      const current = toUser(u);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const set = diffUser(u, input);
    checkUpdate(c, u, set);
    if (Object.keys(set).length === 0) return toUser(u);
    if (set.role) await guardLastAdmin(tx, u, { role: set.role });
    await tx.transaction((sp) => repo.updateUser(sp, u, set, true)).catch(mapUserConflict);
    ch.changed({ entity: "user", tenantId: u.tenantId });
    return reread(tx, u);
  });
}

/** FR-05: khoá → `active=false` + thu hồi mọi refresh token; đã khoá → trả bản hiện tại, không ghi. */
export function lockUser(c: Call, id: string): Promise<User> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const seen = await mustFindUser(tx, c.actor, id);
    fail(checkSelfAction(c.actor, seen.id, "lock"));
    if (!seen.active) return toUser(seen);
    const u = await lockTarget(tx, c.actor, seen);
    if (!u.active) return toUser(u);
    await guardLastAdmin(tx, u, { active: false });
    await repo.updateUser(tx, u, { active: false }, true);
    await revokeUserSessions(tx, { tenantId: u.tenantId, userId: u.id, reason: "user_locked" });
    ch.changed({ entity: "user", tenantId: u.tenantId });
    return reread(tx, u);
  });
}

/** Mở khoá: `active=true` + xoá khoá tạm; không gỡ `locked_by_tenant` (M1-R10). Lặp lại không tăng version. */
export function unlockUser(c: Call, id: string): Promise<User> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const u = await lockTarget(tx, c.actor, await mustFindUser(tx, c.actor, id));
    const clear = { failedLogins: 0, lockedUntil: null };
    // Chỉ bỏ khoá tạm (sổ sách đăng nhập) → không bump (M3-R15); mở lại active → bump.
    if (!u.active) {
      await repo.updateUser(tx, u, { ...clear, active: true }, true);
      ch.changed({ entity: "user", tenantId: u.tenantId });
    } else if (u.lockedUntil !== null) await repo.updateUser(tx, u, clear, false);
    else return toUser(u);
    return reread(tx, u);
  });
}

/** Đăng xuất mọi thiết bị (FR-05): thu hồi refresh token, giữ `active`; access token đã cấp sống tới `exp`. */
export function logoutAll(c: Call, id: string): Promise<void> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const u = await mustFindUser(tx, c.actor, id);
    await revokeUserSessions(tx, { tenantId: u.tenantId, userId: u.id, reason: "logout_all" });
  });
}

/** Reset (M1-R17): mật khẩu tạm 16 ký tự trả một lần, bắt đổi, xoá khoá tạm, thu hồi mọi phiên. */
export async function resetPassword(c: Call, id: string): Promise<{ temp_password: string }> {
  // Chính mình luôn thấy được nên kiểm trước khi tra; băm (~22 ms) ngoài transaction.
  fail(checkSelfAction(c.actor, id, "reset_password"));
  const temp = await newTempPassword();
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const u = await lockTarget(tx, c.actor, await mustFindUser(tx, c.actor, id));
    const set = { passwordHash: temp.hash, mustChangePassword: true, failedLogins: 0 };
    await repo.updateUser(tx, u, { ...set, lockedUntil: null, passwordChanged: true }, true);
    await revokeUserSessions(tx, { tenantId: u.tenantId, userId: u.id, reason: "password_reset" });
    return { temp_password: temp.pw };
  });
}

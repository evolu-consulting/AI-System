// N5-FR-02, N5-FR-03, N5-FR-04, N5-FR-07 · luật thuần chuyển user mgmt-app (spec N5 §2, §7 R1–R7). Chỉ built-in.
import type {
  AdminRole,
  ExistingTenant,
  ExistingUser,
  Issue,
  OrgIn,
  OrgPlan,
  OrgSeen,
  PackRole,
  PasswordKind,
  UserIn,
  UserInsert,
  UserPlan,
} from "./import";

const PACK_ROLES: readonly string[] = ["owner", "editor", "viewer"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
/** PHC argon2id chặt; tham số kiểm thêm ở `classifyHash` (R7: sàn = admin-api, trần chặn DoS bộ nhớ). */
const ARGON_RE =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$[A-Za-z0-9+/]{11,64}\$[A-Za-z0-9+/]{16,128}$/;

/** FNV-1a 32-bit trên mã UTF-16, hex 8 ký tự thường (R3). */
export function fnv8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * argon2id v19, 19456 ≤ m ≤ 65536 KiB, 2 ≤ t ≤ 4, 1 ≤ p ≤ 2, dài ≤ 256 ⇒ nhập; còn lại ⇒ buộc đặt lại. Trần (security L1):
 * mỗi lần verify cấp `m` KiB, admin-api không rate-limit đăng nhập ⇒ 64 MiB thay vì 256 MiB.
 */
export function classifyHash(h: string | null): PasswordKind {
  if (!h || h.length > 256) return "reset";
  const m = ARGON_RE.exec(h);
  if (!m) return "reset";
  const [mem, t, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ok = mem >= 19456 && mem <= 65536 && t >= 2 && t <= 4 && p >= 1 && p <= 2;
  return ok ? "import" : "reset";
}

const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

/** slug tenant: bỏ dấu, ngoài [a-z0-9] ⇒ '-', gộp, cắt hai đầu, ≤ 32. */
function slugKey(name: string): string {
  return fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

export function tenantKeyFor(o: OrgIn): string {
  if (o.tenantKey) return o.tenantKey;
  const s = slugKey(o.name);
  return s.length >= 2 ? s : `org-${fnv8(o.id)}`;
}

/** Phần trước `@`, bỏ dấu, ngoài [a-z0-9._-] ⇒ '-', ≤ 32; 1 ký tự ⇒ thêm `-u`; rỗng ⇒ `u-<fnv8>`. */
export function usernameBase(email: string): string {
  const local = email.slice(0, email.lastIndexOf("@"));
  const s = fold(local)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (s.length === 0) return `u-${fnv8(email.toLowerCase())}`;
  return s.length < 2 ? `${s}-u` : s;
}

export const usernameFallback = (email: string): string =>
  `${usernameBase(email).slice(0, 23)}-${fnv8(email.toLowerCase())}`;

/** owner ⇒ tenant_admin, editor/viewer ⇒ member; khác ⇒ null (không bao giờ platform_admin). */
export function adminRoleOf(r: string | null): AdminRole | null {
  if (r === "owner") return "tenant_admin";
  return r === "editor" || r === "viewer" ? "member" : null;
}

/** Cắt theo code point (M2): `slice` theo UTF-16 có thể để lại nửa cặp surrogate ⇒ jsonb 22023; DB đếm code point. */
export const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export const normEmail = (e: string): string => e.trim().toLowerCase();
export const validEmail = (e: string): boolean => e.length <= 254 && EMAIL_RE.test(e);

/** Tenant đã có của org: cùng nguồn ⇒ dùng lại (trừ inactive / gói bị thu hồi); khác nguồn ⇒ ORG_MISMATCH (M1). */
function reuseOrFail(
  plan: OrgPlan,
  o: OrgIn,
  t: ExistingTenant,
  source: string,
  fail: (code: Issue["code"]) => void,
) {
  if (t.mgmtSource !== source) fail("ORG_MISMATCH");
  else if (!t.active) fail("TENANT_INACTIVE");
  else if (t.packRevoked) fail("PACK_REVOKED");
  else plan.reuse.push({ orgId: o.id, tenantId: t.id, key: t.key });
}

/**
 * Org → tenant (R2, R4, R6, M1): khớp marker `(mgmt_source, mgmt_org_id)`; org id đã có ở nguồn khác ⇒ ORG_MISMATCH;
 * không thì tạo với key chưa ai dùng. `st` giữ id/key đã gặp ở các lô trước (DUP_ORG/DUPLICATE_KEY xuyên lô).
 */
export function planOrgs(
  orgs: readonly OrgIn[],
  existing: readonly ExistingTenant[],
  source: string,
  st: OrgSeen = { ids: new Set(), keys: new Set() },
): OrgPlan {
  const plan: OrgPlan = { creates: [], reuse: [], failed: [], issues: [] };
  const seen = st.ids;
  const used = st.keys;
  const fail = (ref: string, code: Issue["code"]) => {
    plan.failed.push(ref);
    plan.issues.push({ kind: "org", ref, code });
  };
  for (const o of orgs) {
    if (seen.has(o.id)) {
      plan.issues.push({ kind: "org", ref: o.id, code: "DUP_ORG" });
      continue;
    }
    seen.add(o.id);
    const mine =
      existing.find((t) => t.mgmtOrgId === o.id && t.mgmtSource === source) ??
      existing.find((t) => t.mgmtOrgId === o.id);
    if (mine) {
      reuseOrFail(plan, o, mine, source, (code) => fail(o.id, code));
      continue;
    }
    const key = tenantKeyFor(o);
    if (used.has(key)) fail(o.id, "DUPLICATE_KEY");
    else if (existing.some((t) => t.key === key)) fail(o.id, "ORG_KEY_TAKEN");
    else {
      used.add(key);
      plan.creates.push({ orgId: o.id, key, name: cut(o.name, 128) });
    }
  }
  return plan;
}

type UserCtx = {
  tenantOf: ReadonlyMap<string, string | null>;
  hasGroup: (tenantId: string, role: PackRole) => boolean;
  byEmail: Map<string, ExistingUser>;
  taken: Set<string>;
  seen: Set<string>;
  plan: UserPlan;
};

/** Lỗi hàng trước khi chọn tenant (R2); trả tenant id khi hợp lệ. */
function precheck(c: UserCtx, u: UserIn, email: string): string | null {
  const issue = (code: Issue["code"], ref = email) => {
    c.plan.issues.push({ kind: "user", ref, code });
    return null;
  };
  if (!validEmail(email)) return issue("INVALID_EMAIL", u.email);
  if (c.seen.has(email)) return issue("DUPLICATE_EMAIL");
  c.seen.add(email);
  if (u.orgId === null) return issue("NO_ORG");
  if (!c.tenantOf.has(u.orgId)) return issue("UNKNOWN_ORG");
  const tid = c.tenantOf.get(u.orgId) ?? null;
  if (tid === null) return issue("ORG_FAILED");
  if (adminRoleOf(u.orgRole) === null) return issue("BAD_ROLE");
  if (!c.hasGroup(tid, u.orgRole as PackRole)) return issue("GROUP_MISSING");
  return tid;
}

/**
 * User đã có — KHÔNG gắn Group lại (L2: không hoàn tác việc admin gỡ thành viên). Cùng vai ⇒ `existing`; vai khác ⇒
 * ROLE_CONFLICT; không còn vai nào ⇒ ROLE_MISSING (vận hành gán tay nếu muốn). Mỗi user đếm đúng một lần.
 */
function checkExisting(c: UserCtx, ex: ExistingUser, role: PackRole, email: string): void {
  if (ex.roles.includes(role)) c.plan.existing++;
  else {
    const code = ex.roles.length > 0 ? "ROLE_CONFLICT" : "ROLE_MISSING";
    c.plan.issues.push({ kind: "user", ref: email, code });
  }
}

function pickUsername(c: UserCtx, tid: string, email: string): string | null {
  for (const name of [usernameBase(email), usernameFallback(email)]) {
    if (!c.taken.has(`${tid}\n${name}`)) {
      c.taken.add(`${tid}\n${name}`);
      return name;
    }
  }
  return null;
}

function newUser(u: UserIn, tid: string, email: string, username: string): UserInsert {
  const role = u.orgRole as PackRole;
  const password = classifyHash(u.passwordHash);
  const local = email.slice(0, email.lastIndexOf("@"));
  return {
    tenantId: tid,
    email,
    username,
    displayName: cut(u.name.trim() || local, 64),
    role: adminRoleOf(role) as AdminRole,
    packRole: role,
    locale: u.locale,
    password,
    importedHash: password === "import" ? u.passwordHash : null,
  };
}

/** Lô user (R2–R6, B1): tenant theo org; khớp (tenant, email) trên user đọc theo username ứng viên; trùng ⇒ fallback. */
export function planUsers(
  users: readonly UserIn[],
  tenantOf: ReadonlyMap<string, string | null>,
  existing: readonly ExistingUser[],
  /** Email đã gặp ở các lô trước của cùng lần chạy (DUPLICATE_EMAIL xuyên lô). */
  seen: Set<string> = new Set(),
  /** Tenant có Group vai (Group bị admin xoá ⇒ GROUP_MISSING, không tạo lại — L2). */
  hasGroup: (tenantId: string, role: PackRole) => boolean = () => true,
): UserPlan {
  const c: UserCtx = {
    tenantOf,
    hasGroup,
    byEmail: new Map(existing.map((e) => [`${e.tenantId}\n${e.email}`, e])),
    taken: new Set(existing.map((e) => `${e.tenantId}\n${e.username}`)),
    seen,
    plan: { inserts: [], existing: 0, issues: [] },
  };
  for (const u of users) {
    const email = normEmail(u.email);
    const tid = precheck(c, u, email);
    if (tid === null) continue;
    const ex = c.byEmail.get(`${tid}\n${email}`);
    if (ex) {
      checkExisting(c, ex, u.orgRole as PackRole, email);
      continue;
    }
    const username = pickUsername(c, tid, email);
    if (username === null) c.plan.issues.push({ kind: "user", ref: email, code: "USERNAME_TAKEN" });
    else c.plan.inserts.push(newUser(u, tid, email, username));
  }
  return c.plan;
}

export const isPackRole = (r: string): r is PackRole => PACK_ROLES.includes(r);

// niti-onboard · docs/specs/niti-onboard: luật thuần của onboarding tenant từ file khai báo (deploy/tenants/<key>.yaml) —
// dựng hàng Group/phòng ban (cây: gốc + con, cha phải khai TRƯỚC con ⇒ không vòng), gán thành viên theo email, marker importer.
// Lớp 1 (ADR-0023): chỉ built-in ECMAScript; kiểm đầu vào bằng zod ở `adapters/onboard.schema.ts`.

export type DeptIn = {
  key: string;
  vi: string;
  en?: string | undefined;
  /** Khoá phòng cha; vắng ⇒ dưới gốc. */
  parent?: string | undefined;
  head?: string | undefined;
  members: string[];
};

/** CR-159 · người dùng khai trong yaml: `admin` = quản trị công ty (tenant_admin), `member` = thành viên thường. */
export type PackRole = "owner" | "editor" | "viewer";
export type UserIn = {
  email: string;
  name: string;
  title: string;
  role: "admin" | "member";
  pack_role?: PackRole | undefined;
};
/** Người dùng hiện có (tra theo email) — chỉ các trường onboarding được phép cập nhật. */
export type UserNow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  version: number;
  job_title: string | null;
};
export type UserUpdate = {
  id: string;
  email: string;
  version: number;
  set: { display_name?: string; role?: "tenant_admin" | "member" };
  title?: string;
};

export type OnboardSpec = {
  key: string;
  name: string;
  timezone: string;
  profile: Record<string, unknown>;
  packs: string[];
  /** CR-159 · add-on (khoá tính năng) bật qua entitlement, vd `contracts-community` (Bảng tin). */
  addons: string[];
  users: UserIn[];
  root: Omit<DeptIn, "parent">;
  departments: DeptIn[];
  /** Gắn tenant với org mgmt-app cho importer I1 (marker `settings.mgmt_source/mgmt_org_id`); org null ⇒ chưa gắn. */
  import?: { source: string; org_id: string | null } | undefined;
};
export type DeptRow = {
  key: string;
  name: { vi: string; en?: string };
  parent: string | null;
  sort: number;
};
export type SpecIssue = { code: "DUP_DEPT_KEY" | "PARENT_UNKNOWN"; ref: string };

export const roleOf = (r: UserIn["role"]): "tenant_admin" | "member" =>
  r === "admin" ? "tenant_admin" : "member";

/** CR-159 · người THƯỜNG vào nhóm vai nào của gói: khai `pack_role` hoặc mặc định `editor`. Quản trị do `enablePack` lo (Chủ gói). */
export const packRoleRows = (users: readonly UserIn[]): { username: string; role: PackRole }[] =>
  users
    .filter((u) => u.role === "member")
    .map((u) => ({ username: usernameOf(u.email), role: u.pack_role ?? "editor" }));

/** Tên đăng nhập = phần trước `@` của email (đã chữ thường). */
export const usernameOf = (email: string): string => email.slice(0, email.indexOf("@"));

/**
 * Kế hoạch người dùng: chưa có (theo email) ⇒ tạo; đã có ⇒ chỉ cập nhật tên/vai/chức vụ khi khác. Không đụng mật khẩu.
 * Hàm thuần — `now` là kết quả tra một lần theo email.
 */
export function planUsers(
  want: readonly UserIn[],
  now: readonly UserNow[],
): { create: UserIn[]; update: UserUpdate[]; unchanged: number } {
  const byEmail = new Map(now.map((u) => [u.email.toLowerCase(), u]));
  const create: UserIn[] = [];
  const update: UserUpdate[] = [];
  for (const w of want) {
    const cur = byEmail.get(w.email);
    if (!cur) {
      create.push(w);
      continue;
    }
    const set: UserUpdate["set"] = {};
    if (cur.display_name !== w.name) set.display_name = w.name;
    if (cur.role !== roleOf(w.role)) set.role = roleOf(w.role);
    const titleChanged = cur.job_title !== w.title;
    if (Object.keys(set).length === 0 && !titleChanged) continue;
    update.push({
      id: cur.id,
      email: w.email,
      version: cur.version,
      set,
      ...(titleChanged ? { title: w.title } : {}),
    });
  }
  return { create, update, unchanged: want.length - create.length - update.length };
}

/** Hàng phòng ban theo thứ tự khai (sort = vị trí); cha phải là gốc hoặc phòng khai trước ⇒ cây không vòng. */
export function deptRows(s: OnboardSpec): { rows: DeptRow[]; issues: SpecIssue[] } {
  const rows: DeptRow[] = [];
  const issues: SpecIssue[] = [];
  const seen = new Set<string>();
  const add = (d: { key: string; vi: string; en?: string }, parent: string | null) => {
    if (seen.has(d.key)) return issues.push({ code: "DUP_DEPT_KEY", ref: d.key });
    if (parent !== null && !seen.has(parent))
      return issues.push({ code: "PARENT_UNKNOWN", ref: d.key });
    seen.add(d.key);
    const name = d.en ? { vi: d.vi, en: d.en } : { vi: d.vi };
    rows.push({ key: d.key, name, parent, sort: rows.length });
  };
  add(s.root, null);
  for (const d of s.departments) add(d, d.parent ?? s.root.key);
  return { rows, issues };
}

/** Cặp (phòng, email) thành viên + trưởng phòng (trưởng phòng cũng là thành viên — M1D-FR-03 thấy theo thành viên). */
export function memberPairs(s: OnboardSpec): {
  members: { key: string; email: string }[];
  heads: { key: string; email: string }[];
} {
  const members: { key: string; email: string }[] = [];
  const heads: { key: string; email: string }[] = [];
  const seen = new Set<string>();
  for (const d of [s.root as DeptIn, ...s.departments]) {
    const emails = d.head ? [d.head, ...d.members] : d.members;
    for (const e of emails.map((x) => x.toLowerCase())) {
      const k = `${d.key}|${e}`;
      if (seen.has(k)) continue;
      seen.add(k);
      members.push({ key: d.key, email: e });
    }
    if (d.head) heads.push({ key: d.key, email: d.head.toLowerCase() });
  }
  return { members, heads };
}

export type Binding = { source: string; orgId: string };
export type BindDecision = { kind: "none" } | { kind: "set"; b: Binding } | { kind: "keep" };

/**
 * Marker importer: chưa khai org ⇒ không đụng; tenant chưa có marker ⇒ đặt; marker trùng ⇒ giữ; marker khác (nguồn/org) ⇒
 * ORG_REBIND (không lặng lẽ trỏ tenant thật sang org khác — dữ liệu đã nhập theo marker cũ).
 */
export function bindDecision(
  want: Binding | null,
  cur: { source: string | null; orgId: string | null },
): BindDecision | { kind: "error"; code: "ORG_REBIND" } {
  if (!want) return { kind: "none" };
  if (cur.orgId === null && cur.source === null) return { kind: "set", b: want };
  if (cur.orgId === want.orgId && cur.source === want.source) return { kind: "keep" };
  return { kind: "error", code: "ORG_REBIND" };
}

/**
 * CR-121 · D6: 4 khoá hồ sơ đã chuyển sang CỘT `admin.tenants` (0035), nguồn duy nhất — onboarding ghi cột, jsonb `profile` chỉ giữ
 * phần còn lại (websites, zalo_oa, phones). Khoá jsonb (spec) ⇒ tên cột.
 */
export const MOVED_PROFILE_KEYS = {
  legal_name: "legal_name",
  address: "address",
  tax_id: "tax_code",
  email: "contact_email",
} as const;
type MovedKey = keyof typeof MOVED_PROFILE_KEYS;

/** Tách hồ sơ spec: `cols` (chỉ khoá spec CÓ, theo tên cột) + `rest` (jsonb còn lại). */
export function splitProfile(p: Record<string, unknown>): {
  cols: Record<string, string>;
  rest: Record<string, unknown>;
} {
  const cols: Record<string, string> = {};
  const rest: Record<string, unknown> = { ...p };
  for (const k of Object.keys(MOVED_PROFILE_KEYS) as MovedKey[]) {
    delete rest[k];
    if (typeof p[k] === "string") cols[MOVED_PROFILE_KEYS[k]] = p[k] as string;
  }
  return { cols, rest };
}

/** Hồ sơ hiện tại (đã gộp cột + jsonb) so với spec: khoá chuyển-cột mà spec KHÔNG khai thì bỏ qua (giữ giá trị người dùng đã nhập tay). */
export function profileSame(cur: Record<string, unknown>, spec: Record<string, unknown>): boolean {
  const c = { ...cur };
  for (const k of Object.keys(MOVED_PROFILE_KEYS)) if (spec[k] === undefined) delete c[k];
  return sameJson(c, spec);
}

/** So hai jsonb hồ sơ theo nội dung (thứ tự khoá không tính) — bỏ câu ghi khi không đổi (idempotent, không tăng version). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(norm)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .filter(([, v]) => v !== undefined)
              .sort(([p], [q]) => p.localeCompare(q))
              .map(([k, v]) => [k, norm(v)]),
          )
        : x;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

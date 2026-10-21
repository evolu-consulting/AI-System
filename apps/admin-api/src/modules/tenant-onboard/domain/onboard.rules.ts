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

export type OnboardSpec = {
  key: string;
  name: string;
  timezone: string;
  profile: Record<string, unknown>;
  packs: string[];
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

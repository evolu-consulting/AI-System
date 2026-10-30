// CR-105 · L2a · design §4 B2: kiểm trước khi xuất bản / quay lại / gán / đổi mặc định def thư viện. Thuần.
// (1) luật khe (`SlotSpec.validate`, truyền vào `bodyIssues`) → (2) đủ nút hệ thống của khe (stage tool `systemTools`) → (3) không
// bước không tới được: điều kiện `stage.slot.when` (dạng FlowWhen: `deal ∈ […]`, `total_value ge|gt|le|lt`, and/or) không bao giờ đúng.
export type PublishIssue = { path: string; rule: string };

type Cond =
  | { field: "deal"; in: readonly string[] }
  | { field: "total_value"; op: "ge" | "gt" | "le" | "lt"; value: number };
type When = { op: "and" | "or"; conds: readonly Cond[] };
type StageLike = { executor?: { kind?: string; tool_key?: string }; slot?: unknown };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

type Bound = { v: number; open: boolean };
type Num = Extract<Cond, { field: "total_value" }>;
const tighterLo = (b: Bound, c: Num): Bound =>
  c.value > b.v || (c.value === b.v && c.op === "gt") ? { v: c.value, open: c.op === "gt" } : b;
const tighterHi = (b: Bound, c: Num): Bound =>
  c.value < b.v || (c.value === b.v && c.op === "lt") ? { v: c.value, open: c.op === "lt" } : b;

/** Khoảng giá trị (≥ 0) thoả mọi điều kiện `total_value` + giao các tập loại HĐ còn khác rỗng. */
function andSatisfiable(conds: readonly Cond[]): boolean {
  let lo: Bound = { v: 0, open: false };
  let hi: Bound = { v: Number.POSITIVE_INFINITY, open: false };
  let deals: string[] | null = null;
  for (const c of conds) {
    if (c.field === "deal") deals = c.in.filter((d) => deals === null || deals.includes(d));
    else if (c.op === "ge" || c.op === "gt") lo = tighterLo(lo, c);
    else hi = tighterHi(hi, c);
  }
  if (deals !== null && deals.length === 0) return false;
  return lo.v < hi.v || (lo.v === hi.v && !lo.open && !hi.open);
}

/** Điều kiện có giá trị HĐ thật (loại HĐ, giá trị ≥ 0) làm nó đúng; null ⇒ luôn đúng. */
export function whenSatisfiable(w: unknown): boolean {
  if (!isObj(w) || !Array.isArray(w.conds)) return true;
  const x = w as unknown as When;
  return x.op === "or" ? x.conds.some((c) => andSatisfiable([c])) : andSatisfiable(x.conds);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_FIELDS = new Set(["approver_user_id", "user_id"]);
const userIdOf = (k: string, v: unknown): string | null =>
  USER_FIELDS.has(k) && typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;

/** Id người dùng cụ thể trong body (người duyệt / người ký) — thuộc MỘT tenant; B2 kiểm theo từng tenant đang dùng. */
export function bodyUserIds(body: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: unknown): void => {
    const entries = Array.isArray(x)
      ? x.map((v) => ["", v] as const)
      : isObj(x)
        ? Object.entries(x)
        : [];
    for (const [k, v] of entries) {
      const id = userIdOf(k, v);
      if (id) out.add(id);
      else walk(v);
    }
  };
  walk(body);
  return [...out];
}

export function publishIssues(i: {
  stages: readonly StageLike[];
  systemTools: readonly string[];
  bodyIssues: readonly PublishIssue[];
}): PublishIssue[] {
  if (i.bodyIssues.length) return i.bodyIssues.slice(0, 20);
  const tools = new Set(
    i.stages.flatMap((s) =>
      s.executor?.kind === "tool" && s.executor.tool_key ? [s.executor.tool_key] : [],
    ),
  );
  const out: PublishIssue[] = i.systemTools
    .filter((k) => !tools.has(k))
    .map((k) => ({ path: "stages", rule: `SYSTEM_TOOL_MISSING:${k}` }));
  i.stages.forEach((s, j) => {
    if (isObj(s.slot) && !whenSatisfiable(s.slot.when))
      out.push({ path: `stages.${j}.slot.when`, rule: "UNREACHABLE_STEP" });
  });
  return out.slice(0, 20);
}

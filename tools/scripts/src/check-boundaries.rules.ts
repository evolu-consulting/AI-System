// CR-121 phần B · ADR-0037 · luật thuần của `bun run check:boundaries`: phân loại cạnh import giữa module hub-api,
// so với baseline (chỉ được co lại). Phải khớp 3 luật cùng tên trong `.dependency-cruiser.cjs`
// (cross-module-deep, cross-module-flat, no-prod-import-testing); bản này quét bằng regex để chạy < 1 s
// (depcruise toàn hub-api mất ~30 s).

export type RuleName = "cross-module-deep" | "cross-module-flat" | "no-prod-import-testing";
export const RULE_NAMES: readonly RuleName[] = [
  "cross-module-deep",
  "cross-module-flat",
  "no-prod-import-testing",
];

export type Violation = { rule: RuleName; from: string; to: string };

/** Một mục baseline theo khuôn `depcruise --output-type baseline` (dùng được với `--ignore-known`). */
export type KnownViolation = {
  type: "dependency";
  from: string;
  to: string;
  rule: { severity: "error"; name: RuleName };
};

export const SRC = "apps/hub-api/src/";
// Đơn vị module: `modules/<m>/`; riêng `modules/packs/<gói>/` (kit, community, contracts…) mỗi gói là một module.
const MOD = "(packs/[^/]+|[^/]+)";
const MODULE_RE = new RegExp(`^apps/hub-api/src/modules/${MOD}/`);
const DEEP_RE = new RegExp(`^apps/hub-api/src/modules/${MOD}/(adapters|application|domain)/`);
const TESTING_RE = new RegExp(`^apps/hub-api/src/modules/${MOD}/testing/`);
const PUBLIC_RE = new RegExp(`^apps/hub-api/src/modules/${MOD}/public\\.ts$`);
const TEST_FILE_RE = /\.test\.tsx?$/;
const MOUNT_RE = /\.mount\.ts$/;

export function moduleOf(path: string): string | null {
  return MODULE_RE.exec(path)?.[1] ?? null;
}

/** Cạnh import `from → to` (đường dẫn tương đối gốc repo, `/`) vi phạm luật nào; null nếu hợp lệ. */
export function classify(from: string, to: string): RuleName | null {
  if (!from.startsWith(SRC)) return null;
  const isTest = TEST_FILE_RE.test(from);
  if (TESTING_RE.test(to)) {
    return !isTest && !/(^|\/)testing\//.test(from) ? "no-prod-import-testing" : null;
  }
  const a = moduleOf(from);
  const b = moduleOf(to);
  if (a === null || b === null || a === b) return null;
  // File gốc `modules/packs/*.ts` (khung nối gói) thuộc module `packs` chứa mọi `packs/<gói>` — khớp pathNot `modules/$1/` của depcruise.
  if (a === "packs" && b.startsWith("packs/")) return null;
  if (isTest || MOUNT_RE.test(from) || PUBLIC_RE.test(to)) return null;
  return DEEP_RE.test(to) ? "cross-module-deep" : "cross-module-flat";
}

const IMPORT_RES = [
  // import … from "x" / export … from "x" (nhiều dòng được; không nuốt `;` hay dấu nháy)
  /(?:^|[;}\n])\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  // import "x" (side-effect)
  /(?:^|[;}\n])\s*import\s*["']([^"']+)["']/g,
  // import("x"), require("x")
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Specifier tương đối trong một file nguồn (không dò comment/chuỗi kỹ — khớp depcruise trên code thật). */
export function relativeSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      const spec = m[1];
      if (spec?.startsWith(".")) out.add(spec);
    }
  }
  return [...out];
}

/** Ghép `spec` tương đối với thư mục của `fromFile`; chuẩn hoá `.`/`..`, dấu `/`. */
export function joinRelative(fromFile: string, spec: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
/** Resolve specifier về file có thật trong `files` (tập đường dẫn quét); null nếu không có. */
export function resolveTarget(
  from: string,
  spec: string,
  files: ReadonlySet<string>,
): string | null {
  const base = joinRelative(from, spec);
  if (files.has(base)) return base;
  for (const ext of EXTS) if (files.has(base + ext)) return base + ext;
  return null;
}

/** Quét `sources` (đường dẫn → nội dung) ra danh sách vi phạm duy nhất, sắp xếp ổn định. */
export function findViolations(
  sources: ReadonlyMap<string, string>,
  files: ReadonlySet<string> = new Set(sources.keys()),
): Violation[] {
  const seen = new Map<string, Violation>();
  for (const [from, text] of sources) {
    for (const spec of relativeSpecifiers(text)) {
      const to = resolveTarget(from, spec, files);
      if (!to) continue;
      const rule = classify(from, to);
      if (rule) seen.set(`${rule}|${from}|${to}`, { rule, from, to });
    }
  }
  return [...seen.values()].sort(compareViolation);
}

export function compareViolation(a: Violation, b: Violation): number {
  return a.rule.localeCompare(b.rule) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}

export const keyOf = (v: Violation): string => `${v.rule}|${v.from}|${v.to}`;

export function toBaseline(vs: readonly Violation[]): KnownViolation[] {
  return vs.map((v) => ({
    type: "dependency",
    from: v.from,
    to: v.to,
    rule: { severity: "error", name: v.rule },
  }));
}

export function fromBaseline(known: readonly KnownViolation[]): Violation[] {
  return known
    .filter((k) => (RULE_NAMES as readonly string[]).includes(k.rule.name))
    .map((k) => ({ rule: k.rule.name, from: k.from, to: k.to }));
}

export type Comparison = {
  /** Vi phạm mới (không có trong baseline) ⇒ làm check đỏ. */
  added: Violation[];
  /** Có trong baseline nhưng đã hết ⇒ nên co baseline (`--write`). */
  fixed: Violation[];
  current: number;
  baseline: number;
};

export function compare(current: readonly Violation[], baseline: readonly Violation[]): Comparison {
  const base = new Set(baseline.map(keyOf));
  const cur = new Set(current.map(keyOf));
  return {
    added: current.filter((v) => !base.has(keyOf(v))),
    fixed: baseline.filter((v) => !cur.has(keyOf(v))),
    current: cur.size,
    baseline: base.size,
  };
}

export type ModuleCount = {
  module: string;
  deep: number;
  flat: number;
  testing: number;
  total: number;
};

/** Đếm theo module ĐÍCH (module cần đóng gói: về 0 khi có public.ts và importer đã chuyển). */
export function countByTargetModule(vs: readonly Violation[]): ModuleCount[] {
  const map = new Map<string, ModuleCount>();
  for (const v of vs) {
    const module = moduleOf(v.to) ?? "(ngoài modules)";
    const c = map.get(module) ?? { module, deep: 0, flat: 0, testing: 0, total: 0 };
    if (v.rule === "cross-module-deep") c.deep++;
    else if (v.rule === "cross-module-flat") c.flat++;
    else c.testing++;
    c.total++;
    map.set(module, c);
  }
  return [...map.values()].sort((x, y) => y.total - x.total || x.module.localeCompare(y.module));
}

export function totalsByRule(vs: readonly Violation[]): Record<RuleName, number> {
  const t: Record<RuleName, number> = {
    "cross-module-deep": 0,
    "cross-module-flat": 0,
    "no-prod-import-testing": 0,
  };
  for (const v of vs) t[v.rule]++;
  return t;
}

/** Bảng đếm theo module đích, kèm cột baseline để thấy module nào đã về 0. */
export function formatTable(current: readonly Violation[], baseline: readonly Violation[]): string {
  const cur = new Map(countByTargetModule(current).map((c) => [c.module, c]));
  const base = new Map(countByTargetModule(baseline).map((c) => [c.module, c]));
  const names = [...new Set([...cur.keys(), ...base.keys()])];
  const rows = names
    .map((n) => ({ n, c: cur.get(n), b: base.get(n) }))
    .sort((x, y) => (y.b?.total ?? 0) - (x.b?.total ?? 0) || x.n.localeCompare(y.n));
  const lines = [
    `${"module".padEnd(18)} ${"sâu".padStart(5)} ${"phẳng".padStart(6)} ${"testing".padStart(8)} ${"nay".padStart(5)} ${"baseline".padStart(9)}`,
  ];
  for (const r of rows) {
    lines.push(
      `${r.n.padEnd(18)} ${String(r.c?.deep ?? 0).padStart(5)} ${String(r.c?.flat ?? 0).padStart(6)} ${String(r.c?.testing ?? 0).padStart(8)} ${String(r.c?.total ?? 0).padStart(5)} ${String(r.b?.total ?? 0).padStart(9)}`,
    );
  }
  return lines.join("\n");
}

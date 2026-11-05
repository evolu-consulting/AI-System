// tool-affected-modules · chọn theo MODULE cho `test:affected`: file đổi → hạt giống (seed) của bao đóng ngược, kèm lý do.
// - Migration gói (`migrations-pack-<k>`) ⇒ chỉ module của gói; migration lõi chỉ-thêm ⇒ module tham chiếu các bảng đó;
//   mọi thứ khác (đổi đối tượng sẵn có, thư mục lạ) ⇒ rộng như cũ.
// - File gốc theo loại (package.json deps/scripts, biome, tsconfig, lefthook, docs).
// - `strict` ⇒ đúng hành vi cũ. Không phân loại được ⇒ rộng + ghi chú.
// Hàm thuần: I/O (đọc file, git show) truyền vào qua `ScopeDeps`.
import type { Graph } from "./lib/import-graph";
import { PACK_MODULES, packOf } from "./test-affected.packs";
import { analyzeSql, tableRefs } from "./test-affected.sql";

export { affectedScoped, closureWhy } from "./test-affected.closure";
export { isCompositionRoot, PACK_MODULES, packOf } from "./test-affected.packs";

export type Reasons = Map<string, string>;
export type Scope = {
  /** Seed bao đóng ngược ĐẦY ĐỦ. */
  broad: Reasons;
  /** Seed bao đóng ngược CẮT ở file lắp ráp (app.ts/*.mount.ts): module khác boot cả app không bị kéo theo. */
  module: Reasons;
  /** Int luôn chạy khi migration đổi (migrate/RLS meta). */
  extraInt: Reasons;
  /** Cấu hình e2e thêm (theo gói). */
  extraE2e: Reasons;
  unitAll: boolean;
  typecheckAll: boolean;
  /** --strict: hành vi cũ (rộng). */
  strict: boolean;
  /** Có migration phải chọn rộng (đổi đối tượng sẵn có / không phân loại được). */
  migrationBroad: boolean;
  notes: string[];
};

export type ScopeDeps = {
  changed: readonly string[];
  strict: boolean;
  graph: Pick<Graph, "deps">;
  readFile: (f: string) => string | undefined;
  /** Nội dung file ở base (undefined = file chưa có ở base ⇒ file mới). */
  readBase: (f: string) => string | undefined;
};

/** Cổng migration cũ: file nạp/băm migration (kéo mọi int dùng DB mẫu). */
export const MIGRATION_SEEDS = [
  "packages/db/src/migrate.ts",
  "packages/db/src/migrate-hub.ts",
  "packages/db/src/migrate-packs.ts",
  "packages/db/src/test-db-template.ts",
];
/** File cấp gốc đổi ⇒ rộng (hành vi cũ, `--strict`). */
export const GLOBAL_FILES = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "bunfig.int.toml",
  "tsconfig.json",
  "tsconfig.tests.json",
  "tsconfig.depcruise.json",
  "biome.json",
  "turbo.json",
  ".dependency-cruiser.cjs",
  "lefthook.yml",
];

const INT_RE = /\.int\.test\.tsx?$/;
const TEST_RE = /\.test\.tsx?$/;
const SQL_DIR = /^packages\/db\/(migrations[\w-]*)\//;
const PACK_DIR = /^migrations-pack-([\w]+)$/;
const SCHEMA_RE = /^packages\/db\/src\/schema\/[\w-]+\.ts$/;
const SILENT = /^(docs|deploy|\.claude|\.github)\//;
const CORE_DIRS = new Set([
  "migrations",
  "migrations-dev",
  "migrations-hub",
  "migrations-hub-dev",
  "migrations-packs",
]);
/** Migrate/RLS meta: luôn chạy khi migration đổi. */
const META_INT = [
  /^packages\/db\/src\/migrate[\w-]*\.int\.test\.ts$/,
  /^packages\/db\/src\/[\w-]*rls[\w-]*\.int\.test\.ts$/,
  /^packages\/db\/src\/(packs-install|test-db-template)\.int\.test\.ts$/,
  /^packages\/test-kit\/src\/rls-packs\.int\.test\.ts$/,
];
/** `package.json` đổi: `deps` (mọi khoá trừ `scripts`), `scripts` (chỉ scripts), `none`, `unknown` (không đọc được JSON). */
export function packageJsonKind(
  before: string | undefined,
  after: string | undefined,
): "deps" | "scripts" | "none" | "unknown" {
  try {
    const { scripts: sa, ...ra } = JSON.parse(before ?? "{}") as Record<string, unknown>;
    const { scripts: sb, ...rb } = JSON.parse(after ?? "{}") as Record<string, unknown>;
    if (stable(ra) !== stable(rb)) return "deps";
    return stable(sa) === stable(sb) ? "none" : "scripts";
  } catch {
    return "unknown";
  }
}
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q)))
      : x,
  );

const empty = (): Scope => ({
  broad: new Map(),
  module: new Map(),
  extraInt: new Map(),
  extraE2e: new Map(),
  unitAll: false,
  typecheckAll: false,
  strict: false,
  migrationBroad: false,
  notes: [],
});

/** Hành vi cũ (`--strict`): mọi file đổi là seed rộng; migration ⇒ MIGRATION_SEEDS; file gốc ⇒ chạy mọi unit. */
function strictScope(d: ScopeDeps): Scope {
  const s = { ...empty(), strict: true };
  for (const f of d.changed) s.broad.set(f, "strict: file đổi");
  const mig = d.changed.some((f) => f.startsWith("packages/db/migrations"));
  if (mig) for (const f of MIGRATION_SEEDS) s.broad.set(f, "strict: migration đổi");
  if (d.changed.some((f) => GLOBAL_FILES.includes(f))) {
    s.unitAll = true;
    s.notes.push(
      "file cấp gốc đổi (package.json/tsconfig/biome/…): chạy mọi unit; int/e2e nên dùng `bun run test:all`.",
    );
  }
  if (mig)
    s.notes.push("migration đổi: mọi int dùng DB mẫu bị kéo theo (đúng — hash migration đổi).");
  return s;
}

export type RootKind = "deps" | "scripts" | "format" | "typecheck" | "none" | "unknown";
/** Loại thay đổi của file cấp gốc (`pkg` = kết quả `packageJsonKind` khi f là package.json). */
export function classifyRoot(
  f: string,
  pkg: ReturnType<typeof packageJsonKind> = "none",
): RootKind {
  if (f === "package.json") return pkg === "unknown" ? "deps" : pkg === "none" ? "none" : pkg;
  if (f === "bun.lock" || f === "turbo.json" || /^bunfig[\w.]*\.toml$/.test(f)) return "deps";
  if (f === "biome.json") return "format";
  if (/^tsconfig[\w.]*\.json$/.test(f)) return "typecheck";
  if (f === ".dependency-cruiser.cjs" || f === "lefthook.yml") return "none";
  return /\.(md|txt)$/.test(f) || f.startsWith(".git") ? "none" : "unknown";
}

function rootFile(f: string, d: ScopeDeps, s: Scope): void {
  const pkg = f === "package.json" ? packageJsonKind(d.readBase(f), d.readFile(f)) : "none";
  const kind = classifyRoot(f, pkg);
  const why = `gốc ${f}`;
  if (kind === "scripts") {
    for (const t of d.graph.deps.keys())
      if (t.startsWith("tools/")) s.broad.set(t, `${why}: chỉ đổi scripts ⇒ test của tools`);
  } else if (kind === "deps" || kind === "unknown") {
    s.broad.set(
      f,
      `${why}: ${kind === "deps" ? "phụ thuộc/cấu hình chạy" : "chưa phân loại"} ⇒ rộng`,
    );
    s.unitAll = true;
    if (kind === "unknown") s.notes.push(`file gốc chưa phân loại được (${f}): chọn rộng.`);
  } else if (kind === "format") s.unitAll = true;
  else if (kind === "typecheck") s.typecheckAll = true;
}
type FileInfo = { all: readonly string[]; read: (f: string) => string };

/** Test/mã của gói `k`: dưới tiền tố của gói, hoặc int nhắc tới `pack/k`, `/pack/k`, `k.<bảng>`. */
function packFiles(k: string, fi: FileInfo): string[] {
  const m = PACK_MODULES[k];
  if (!m) return [];
  const mention = new RegExp(String.raw`packs?[/-]${k}\b|\b${k}\.[a-z_]+`);
  return fi.all.filter(
    (f) => m.prefixes.some((p) => f.startsWith(p)) || (INT_RE.test(f) && mention.test(fi.read(f))),
  );
}

/** Gói đổi: test/mã của gói + e2e của gói. `sources` = cả mã nguồn của gói là seed (migration: "mọi thứ import gói"); mã đổi thì chỉ test. */
function addPack(k: string, why: string, fi: FileInfo, s: Scope, sources: boolean): void {
  for (const f of packFiles(k, fi))
    if (sources || /\.test\.tsx?$|^(tests|e2e)\//.test(f)) s.module.set(f, `gói ${k}: ${why}`);
  for (const c of PACK_MODULES[k]?.e2e ?? []) s.extraE2e.set(c, `gói ${k}: ${why}`);
}
function addMeta(why: string, fi: FileInfo, s: Scope): void {
  for (const f of fi.all)
    if (META_INT.some((r) => r.test(f))) s.extraInt.set(f, `migrate/RLS meta: ${why}`);
}

/** Mã nguồn nhắc bảng: KHÔNG lan theo importer, chỉ chọn test của chính module/gói đó. alse = mã dùng chung. */
function sourceRef(f: string, why: string, fi: FileInfo, s: Scope): boolean {
  const k = packOf(f);
  const m = MODULE_RE.exec(f)?.[1];
  if (k) addPack(k, why, fi, s, false);
  else if (m) moduleTests(m, why, fi, s);
  return k !== undefined || m !== undefined;
}

function moduleTests(m: string, why: string, fi: FileInfo, s: Scope): void {
  for (const f of fi.all) if (f.startsWith(`${m}/`) && TEST_RE.test(f)) s.module.set(f, why);
}

/** Migration lõi chỉ-thêm/đổi-dữ-liệu ⇒ mọi file nhắc tới các bảng đó là seed (trong `modules/` hoặc gói: cắt ở file lắp ráp). */
function addTableRefs(
  tables: string[],
  why: string,
  fi: FileInfo,
  s: Scope,
  idents: string[] = [],
): void {
  const ref = tableRefs(tables, idents);
  if (!ref) return;
  const label = `${why}: nhắc bảng ${tables
    .filter((t) => !t.includes("."))
    .slice(0, 3)
    .join(",")}`;
  let shared = 0;
  for (const f of fi.all) {
    if (f.startsWith("packages/db/src/") && !INT_RE.test(f)) continue;
    if (!ref.test(fi.read(f))) continue;
    // Test, hoặc mã trong module/gói ⇒ seed (cắt ở file lắp ráp). Mã/helper dùng chung (packages/*, lib, tests/_fixtures)
    // chỉ nhắc tên bảng: KHÔNG lan theo importer (barrel = mọi thứ) — test nhắc bảng trực tiếp vẫn được chọn.
    if (TEST_RE.test(f)) s.module.set(f, label);
    else if (!sourceRef(f, label, fi, s)) shared++;
  }
  if (shared)
    s.notes.push(
      `${shared} file dùng chung nhắc bảng (${why}) không lan theo import; --strict để chọn rộng.`,
    );
}

function migrations(files: string[], d: ScopeDeps, fi: FileInfo, s: Scope): void {
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = SQL_DIR.exec(f)?.[1] ?? "";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  for (const [dir, fs] of byDir) {
    const pack = PACK_DIR.exec(dir)?.[1];
    if (pack && PACK_MODULES[pack]) {
      addPack(pack, `migration ${fs[0]}`, fi, s, true);
      addMeta(`migration gói ${pack}`, fi, s);
    } else if (CORE_DIRS.has(dir)) coreMigration(dir, fs, d, fi, s);
    else
      broadMigration(dir || "?", `thư mục migration lạ (${dir || "?"}): chưa phân loại ⇒ rộng`, s);
  }
}

function broadMigration(dir: string, why: string, s: Scope): void {
  s.migrationBroad = true;
  for (const f of MIGRATION_SEEDS) s.broad.set(f, `migration ${dir}: ${why}`);
  s.notes.push(`migration ${dir}: ${why}.`);
}

/** `{tables}` khi mọi .sql MỚI chỉ thêm/đổi dữ liệu; ngược lại `{why}` (lý do chọn rộng). */
function judgeCore(files: string[], d: ScopeDeps): { tables: string[] } | { why: string } {
  const sqls = files.filter((f) => f.endsWith(".sql"));
  if (!sqls.length) return { why: "chỉ đổi meta/journal, không có .sql mới" };
  const tables: string[] = [];
  for (const f of sqls) {
    const text = d.readFile(f);
    if (text === undefined) return { why: `${f} bị xoá` };
    if (d.readBase(f) !== undefined) return { why: `${f} là migration cũ bị sửa` };
    const r = analyzeSql(text);
    if (!r.scoped) return { why: `${f} đổi đối tượng sẵn có (${r.reason})` };
    tables.push(...r.tables);
  }
  return { tables: [...new Set(tables)] };
}

function coreMigration(dir: string, files: string[], d: ScopeDeps, fi: FileInfo, s: Scope): void {
  const r = judgeCore(files, d);
  if ("why" in r) {
    broadMigration(dir, r.why, s);
    return;
  }
  addMeta(`migration lõi ${dir}`, fi, s);
  addTableRefs(r.tables, `migration ${dir} chỉ thêm/đổi dữ liệu`, fi, s);
  const names = [...new Set(r.tables.map((t) => t.split(".").pop()))].join(", ");
  s.notes.push(`migration ${dir}: chỉ thêm/đổi dữ liệu ⇒ chọn theo bảng (${names}).`);
}
const SCHEMA_TABLE = /\b(?:pgTable|\.table)\(\s*["'`](\w+)["'`]/g;
const SCHEMA_EXPORT = /export const (\w+)\s*=/g;

/**
 * File schema Drizzle đổi (`packages/db/src/schema/*.ts`): đi kèm migration CHỈ-THÊM ⇒ chọn theo tên bảng + tên export
 * (không kéo mọi importer của barrel); không có migration đi kèm / migration rộng ⇒ rộng như cũ.
 */
function schemaFiles(files: string[], narrow: boolean, d: ScopeDeps, fi: FileInfo, s: Scope): void {
  const tables: string[] = [];
  const idents: string[] = [];
  for (const f of files) {
    const text = d.readFile(f) ?? "";
    // Narrow: KHÔNG làm seed (importer barrel = mọi thứ); chỉ những file nhắc bảng/export mới là seed.
    if (!narrow) s.broad.set(f, "file schema đổi");
    for (const m of text.matchAll(SCHEMA_TABLE)) if (m[1]) tables.push(m[1]);
    for (const m of text.matchAll(SCHEMA_EXPORT)) if (m[1]) idents.push(m[1]);
  }
  if (narrow) addTableRefs(tables, "file schema đổi", fi, s, idents);
}

/** File mã/dữ liệu thường: thuộc gói ⇒ seed module (cắt ở file lắp ráp), còn lại seed rộng. */
const MODULE_RE = /^(apps\/[^/]+\/src\/modules\/[^/]+)\//;

/**
 * File mã/dữ liệu thường: thuộc gói ⇒ seed module; thuộc `apps/*\/src/modules/<m>/` ⇒ seed module + test của chính module đó;
 * còn lại (lib, packages/*, shell…) ⇒ seed rộng. Seed module cắt cạnh ngược tại file lắp ráp (app.ts, *.mount.ts).
 */
function codeFile(f: string, s: Scope, packs: Set<string>, mods: Set<string>): void {
  const k = packOf(f);
  const m = MODULE_RE.exec(f)?.[1];
  if (k) {
    s.module.set(f, `gói ${k}: mã đổi`);
    packs.add(k);
  } else if (m) {
    s.module.set(f, `module ${m}: mã đổi`);
    mods.add(m);
  } else s.broad.set(f, "file đổi");
}
/** Đọc nội dung có nhớ đệm (file không đọc được ⇒ chuỗi rỗng). */
function fileInfo(d: ScopeDeps, all: readonly string[]): FileInfo {
  const cache = new Map<string, string>();
  return {
    all,
    read: (f) => {
      const hit = cache.get(f);
      if (hit !== undefined) return hit;
      const v = d.readFile(f) ?? "";
      cache.set(f, v);
      return v;
    },
  };
}

/** Phân loại file đổi → seed + lý do. `fi.all` = mọi file mã trong đồ thị. */
export function buildScope(d: ScopeDeps, all: readonly string[]): Scope {
  if (d.strict) return strictScope(d);
  const s = empty();
  const fi = fileInfo(d, all);
  const migs: string[] = [];
  const schemas: string[] = [];
  const packs = new Set<string>();
  const mods = new Set<string>();
  for (const f of d.changed) {
    if (SILENT.test(f)) continue;
    if (!f.includes("/")) rootFile(f, d, s);
    else if (SQL_DIR.test(f)) migs.push(f);
    else if (SCHEMA_RE.test(f)) schemas.push(f);
    else codeFile(f, s, packs, mods);
  }
  for (const k of packs) addPack(k, "mã đổi", fi, s, false);
  for (const m of mods) moduleTests(m, `module ${m}: test của module`, fi, s);
  if (migs.length) migrations(migs, d, fi, s);
  schemaFiles(schemas, migs.length > 0 && !s.migrationBroad, d, fi, s);
  return s;
}

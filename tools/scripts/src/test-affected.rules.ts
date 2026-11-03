// TS1 · luật chọn test của `bun run test:affected` (cổng LÁT; `test:all` vẫn là cổng ĐỢT). Hàm thuần: nhận file đổi + đồ thị
// import (đã tính bao đóng ngược) + danh sách cấu hình e2e, trả kế hoạch: unit / int / cấu hình e2e / kiểm kiểu cần chạy.
import { posix } from "./lib/import-graph";
import { jobSlug } from "./test-e2e-par.rules";

export type E2eMode = "owner" | "wide" | "none";
export type AffectedOpts = { e2e: E2eMode };
export type ConfigInfo = { config: string; tag?: string };

export type AffectedPlan = {
  changed: string[];
  affected: number;
  unit: string[];
  int: string[];
  e2e: string[];
  /** Tên việc `test:e2e:par` của `e2e` (`--only=<việc>`): `root` (mọi ca gốc), `N1`, `chat`, `community-web-stack`… */
  jobs: string[];
  /** Gói (`apps/x`…) có mã dính diff — đối tượng của `typecheck` (turbo). */
  typecheckPackages: string[];
  python: boolean;
  /** Số test bị bỏ vì thuộc người khác (tests/external-owned.json); `main` điền sau `planAffected`. */
  externalSkipped: number;
  /** Chạy `turbo typecheck --filter=...[base]` (có file mã dưới apps/packages/tools đổi). */
  typecheck: boolean;
  /** Chạy `tsc -p tsconfig.tests.json` (bao đóng ngược chạm tests/ hoặc e2e/). */
  typecheckTests: boolean;
  notes: string[];
};

const TEST_RE = /\.test\.tsx?$/;
const INT_RE = /\.int\.test\.tsx?$/;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|mts)$/;

/** File cấp gốc đổi ⇒ ảnh hưởng mọi thứ: chạy hết unit và cảnh báo (int/e2e nên dùng `test:all`). */
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

/** Migration không được import (đọc từ đĩa): coi như đổi các file nạp/băm chúng ⇒ kéo theo mọi int dùng DB mẫu. */
export const MIGRATION_SEEDS = [
  "packages/db/src/migrate.ts",
  "packages/db/src/migrate-hub.ts",
  "packages/db/src/migrate-packs.ts",
  "packages/db/src/test-db-template.ts",
];

/**
 * App web / vùng mã → cấu hình e2e "sở hữu" (không có cạnh import tới e2e: build/serve qua chuỗi lệnh). Khoá là tiền tố thư mục
 * (dài nhất không cần — mọi khoá khớp đều được lấy); giá trị kết thúc bằng `*` = mọi cấu hình có tiền tố đó (vd `e2e/chat/*`).
 * Đổi `packages/contracts` ⇒ bao đóng ngược chạm mọi app import nó ⇒ job của từng app đó (không cần khoá riêng).
 */
export const WEB_OWNERS: Record<string, string[]> = {
  "apps/admin-web": ["playwright.config.ts"],
  "apps/chat-web": ["e2e/chat/*"],
  "apps/studio-web": ["e2e/studio/playwright.config.ts"],
  "apps/contracts-web": ["e2e/contracts-web/playwright.config.ts", "e2e/N1/playwright.config.ts"],
  "apps/community-web": ["e2e/community-web/*"],
  // Thư viện quy trình (UI + hub) → nghiệm thu P-a (module đóng băng: chỉ lấy khi `--frozen`).
  "apps/admin-web/src/features/processes": ["e2e/P-a/playwright.pa.config.ts"],
  "apps/hub-api/src/modules/processes": ["e2e/P-a/playwright.pa.config.ts"],
};
/** Backend → một cấu hình e2e nhỏ nhất có chạy thật backend đó (chế độ `owner`); `wide` lấy mọi cấu hình nối qua đồ thị. */
export const API_OWNERS: Record<string, string[]> = {
  "apps/admin-api": ["playwright.config.ts"],
  // F1: x2b (phòng + agent) đóng băng ⇒ chủ e2e của hub-api là combine (hub thật + chat + admin).
  "apps/hub-api": ["e2e/combine/playwright.config.ts"],
};

/** Tag đuôi file spec của cấu hình (`**\/*.pa.ts` → `pa`); cấu hình gốc không có tag (spec `*.spec.ts`). */
export function configInfos(configs: readonly string[], read: (c: string) => string): ConfigInfo[] {
  return configs.map((raw) => {
    const config = posix(raw);
    const tag = /testMatch:\s*[^,\n]*?\*\.(\w+)\.ts/.exec(read(config))?.[1];
    return tag ? { config, tag } : { config };
  });
}

/** Cấu hình sở hữu một file spec e2e (theo đuôi `.<tag>.ts`; `*.spec.ts` ⇒ cấu hình gốc). */
export function configOfSpec(file: string, infos: readonly ConfigInfo[]): string | undefined {
  if (!file.startsWith("e2e/")) return undefined;
  if (/\.spec\.ts$/.test(file)) return infos.find((i) => !i.tag)?.config;
  const tag = /\.(\w+)\.ts$/.exec(file)?.[1];
  return tag ? infos.find((i) => i.tag === tag)?.config : undefined;
}

const dirOf = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));

export type Inputs = {
  changed: readonly string[];
  /** Bao đóng ngược của `changed` (đã gồm chính chúng) — từ `affectedBy`. */
  affected: ReadonlySet<string>;
  /** Bao đóng ngược chỉ của file ĐỔI dưới `e2e/` (spec/helper/stack/cấu hình sửa trực tiếp) — chế độ `owner`. */
  e2eAffected: ReadonlySet<string>;
  infos: readonly ConfigInfo[];
  exists: (f: string) => boolean;
  /** `true` nếu file là test bị bỏ qua bởi bunfig tương ứng (unit/int). */
  ignoredUnit: (f: string) => boolean;
  ignoredInt: (f: string) => boolean;
  opts: AffectedOpts;
};

/** Cấu hình cụ thể của một mục owner: `e2e/chat/*` ⇒ mọi cấu hình đã biết có tiền tố `e2e/chat/`. */
function expandOwner(c: string, known: ReadonlySet<string>): string[] {
  return c.endsWith("*") ? [...known].filter((k) => k.startsWith(c.slice(0, -1))) : [c];
}

function owners(affected: ReadonlySet<string>, known: ReadonlySet<string>): string[] {
  const hit = (dir: string) => [...affected].some((f) => f.startsWith(`${dir}/`));
  const picked = Object.entries({ ...WEB_OWNERS, ...API_OWNERS })
    .filter(([dir]) => hit(dir))
    .flatMap(([, cfgs]) => cfgs.flatMap((c) => expandOwner(c, known)));
  return [...new Set(picked)];
}

/** Tên việc của `test:e2e:par` cho một cấu hình (`root` = mọi ca của cấu hình gốc: `--only=root` khớp `root-0…`). */
export const jobOfConfig = (config: string): string => jobSlug(config);

/** Thư mục gói (`apps/x`, `packages/x`, `tools/x`) có mã (không phải test) nằm trong `files` — đối tượng của `typecheck`. */
export function typecheckPackages(files: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const m = /^((?:apps|packages|tools)\/[^/]+)\//.exec(f);
    if (m?.[1] && CODE_RE.test(f) && !TEST_RE.test(f)) out.add(m[1]);
  }
  return [...out].sort();
}

/** Cấu hình của file spec/cấu hình nằm trong `files` (spec → theo đuôi tag; file là cấu hình → chính nó). */
function configsIn(files: Iterable<string>, infos: readonly ConfigInfo[]): string[] {
  const known = new Set(infos.map((x) => x.config));
  const out: string[] = [];
  for (const f of files) {
    if (known.has(f)) out.push(f);
    const c = configOfSpec(f, infos);
    if (c) out.push(c);
  }
  return out;
}

function pickE2e(i: Inputs): string[] {
  if (i.opts.e2e === "none") return [];
  const known = new Set(i.infos.map((x) => x.config));
  const picked = new Set<string>([
    // Spec/helper/stack/cấu hình e2e sửa trực tiếp.
    ...configsIn(i.e2eAffected, i.infos),
    // Spec nối tới file đổi ngoài e2e/ (vd helper dùng chung ở tests/): đi theo đồ thị (chỉ lấy spec, không lấy cấu hình).
    ...[...i.affected].flatMap((f) => configOfSpec(f, i.infos) ?? []),
    ...owners(i.affected, known),
  ]);
  // `wide`: mọi cấu hình có file cấu hình nằm trong bao đóng (nối qua import / đường dẫn spawn của stack).
  if (i.opts.e2e === "wide") for (const c of known) if (i.affected.has(c)) picked.add(c);
  return [...picked].filter((c) => known.has(c)).sort();
}

export function planAffected(i: Inputs): AffectedPlan {
  const notes: string[] = [];
  const changed = [...i.changed].map(posix);
  const wide = changed.some((f) => GLOBAL_FILES.includes(f));
  if (wide)
    notes.push(
      "file cấp gốc đổi (package.json/tsconfig/biome/…): chạy mọi unit; int/e2e nên dùng `bun run test:all`.",
    );
  const files = [...i.affected].filter((f) => i.exists(f)).sort();
  const unit = files.filter((f) => TEST_RE.test(f) && !INT_RE.test(f) && !i.ignoredUnit(f));
  const int = files.filter((f) => INT_RE.test(f) && !i.ignoredInt(f));
  const code = changed.some((f) => /^(apps|packages|tools)\//.test(f) && CODE_RE.test(f));
  const testsTouched = files.some((f) => f.startsWith("tests/") || f.startsWith("e2e/"));
  if (changed.some((f) => f.startsWith("packages/db/migrations")))
    notes.push("migration đổi: mọi int dùng DB mẫu bị kéo theo (đúng — hash migration đổi).");
  const e2e = pickE2e(i);
  return {
    changed,
    affected: i.affected.size,
    unit: wide ? ["*"] : unit,
    int,
    e2e,
    jobs: [...new Set(e2e.map(jobOfConfig))].sort(),
    typecheckPackages: typecheckPackages(i.affected),
    externalSkipped: 0,
    python: changed.some((f) => f.startsWith("apps/agent-runtime/")),
    typecheck: code || wide,
    typecheckTests: testsTouched || changed.some((f) => /^(tests|e2e)\//.test(f)),
    notes,
  };
}

/** Rút gọn danh sách file thành tiền tố thư mục khi dòng lệnh quá dài (Windows ~32 k ký tự). */
export function compact(files: readonly string[], maxChars = 6000): string[] {
  if (files.join(" ").length <= maxChars) return [...files];
  const dirs = [...new Set(files.map((f) => `${dirOf(f)}/`))].sort();
  return dirs.join(" ").length <= maxChars ? dirs : ["./"];
}

/** `none` = chỉ lập kế hoạch; `local` = check+typecheck+unit tại máy; `server` = int+e2e trên evotest; `all` = như `test:affected` cũ (mọi thứ tại máy). */
export type RunMode = "none" | "local" | "server" | "all";
/** Kế hoạch dạng JSON (`--json`): unit `["*"]` = mọi unit; file đổi chỉ đếm (danh sách đầy đủ quá dài). */
export function planToJson(base: string, p: AffectedPlan): Record<string, unknown> {
  return {
    base,
    changed: p.changed.length,
    affected: p.affected,
    unit: p.unit,
    int: p.int,
    e2e: { configs: p.e2e, jobs: p.jobs },
    typecheck: { turbo: p.typecheck, packages: p.typecheckPackages, tests: p.typecheckTests },
    python: p.python,
    externalSkipped: p.externalSkipped,
    notes: p.notes,
  };
}

export type AffectedArgs = {
  base?: string;
  dryRun: boolean;
  e2e: E2eMode;
  noE2e: boolean;
  json: boolean;
  run: RunMode;
  /** Quarantine đỏ đã biết (mặc định bật): mã thoát chỉ tính đỏ mới. */
  quarantine: boolean;
  /** Gồm suite của module đóng băng (mặc định bỏ). */
  frozen: boolean;
  /** Gồm test do người khác sở hữu (tests/external-owned.json; mặc định bỏ). */
  includeExternal: boolean;
};

/** `--k=v` hoặc `--k v` (giá trị không bắt đầu bằng `--`). */
function optionValue(argv: readonly string[], k: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${k}=`));
  if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf(`--${k}`);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith("--") ? next : undefined;
}

export function parseAffectedArgs(argv: readonly string[]): AffectedArgs {
  const e2e = optionValue(argv, "e2e") ?? "owner";
  if (!["owner", "wide", "none"].includes(e2e))
    throw new Error(`--e2e phải là owner|wide|none, nhận ${e2e}`);
  const run = optionValue(argv, "run") ?? "none";
  if (!["local", "server", "all", "none"].includes(run))
    throw new Error(`--run phải là local|server|all, nhận ${run}`);
  return {
    base: optionValue(argv, "base"),
    dryRun: argv.includes("--dry-run"),
    e2e: argv.includes("--no-e2e") ? "none" : (e2e as E2eMode),
    noE2e: argv.includes("--no-e2e"),
    json: argv.includes("--json"),
    run: argv.includes("--dry-run") ? "none" : (run as RunMode),
    quarantine: !argv.includes("--no-quarantine"),
    frozen: argv.includes("--frozen"),
    includeExternal: argv.includes("--include-external"),
  };
}

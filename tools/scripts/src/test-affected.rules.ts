// TS1 · luật chọn test của `bun run test:affected` (cổng LÁT; `test:all` vẫn là cổng ĐỢT). Hàm thuần: nhận file đổi + đồ thị
// import (đã tính bao đóng ngược) + danh sách cấu hình e2e, trả kế hoạch: unit / int / cấu hình e2e / kiểm kiểu cần chạy.
import { posix } from "./lib/import-graph";

export type E2eMode = "owner" | "wide" | "none";
export type AffectedOpts = { e2e: E2eMode };
export type ConfigInfo = { config: string; tag?: string };

export type AffectedPlan = {
  changed: string[];
  affected: number;
  unit: string[];
  int: string[];
  e2e: string[];
  python: boolean;
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

/** App web → cấu hình e2e "sở hữu" (không có cạnh import tới e2e: build/serve qua chuỗi lệnh). */
export const WEB_OWNERS: Record<string, string[]> = {
  "apps/admin-web": ["playwright.config.ts"],
  "apps/chat-web": ["e2e/chat/playwright.config.ts"],
  "apps/studio-web": ["e2e/studio/playwright.config.ts"],
  "apps/contracts-web": ["e2e/contracts-web/playwright.config.ts", "e2e/N1/playwright.config.ts"],
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

function owners(affected: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const hit = (dir: string) => [...affected].some((f) => f.startsWith(`${dir}/`));
  for (const [dir, cfgs] of Object.entries({ ...WEB_OWNERS, ...API_OWNERS }))
    if (hit(dir)) for (const c of cfgs) out.add(c);
  return [...out];
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
    ...owners(i.affected),
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
  return {
    changed,
    affected: i.affected.size,
    unit: wide ? ["*"] : unit,
    int,
    e2e: pickE2e(i),
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

export type AffectedArgs = { base?: string; dryRun: boolean; e2e: E2eMode; noE2e: boolean };

export function parseAffectedArgs(argv: readonly string[]): AffectedArgs {
  const val = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const e2e = val("e2e") ?? "owner";
  if (!["owner", "wide", "none"].includes(e2e))
    throw new Error(`--e2e phải là owner|wide|none, nhận ${e2e}`);
  return {
    base: val("base"),
    dryRun: argv.includes("--dry-run"),
    e2e: argv.includes("--no-e2e") ? "none" : (e2e as E2eMode),
    noE2e: argv.includes("--no-e2e"),
  };
}

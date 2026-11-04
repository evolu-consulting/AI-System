// tool-evotest-cache · `bun tools/scripts/src/evotest-cache.ts app-build | src-id | report | status`
//  app-build: script `build` của 5 app web (`bun ../../tools/scripts/src/evotest-cache.ts app-build`) ⇒ KHÔNG sửa cấu hình Playwright
//           (`bun run --filter <gói> build` trong webServer tự đi qua). Có EVO_BUILD_CACHE (evotest đặt /cache/build, dùng chung
//           mọi slot) ⇒ dựng MỘT lần mỗi khoá (commit + bun.lock + PUBLIC_*), các lượt khác chép dist vào thư mục dựng của mình
//           (E2E_DIST_DIR); không đặt biến ⇒ chạy đúng `rsbuild build` như cũ (local/CI không đổi).
//  src-id : in định danh mã nguồn (in-container.sh gọi một lần, đặt EVO_SRC_ID cho mọi lượt dựng sau).
//  report : tóm tắt hit/miss từ .data/build-cache.log (in-container.sh in cuối lượt).
//  status : liệt kê mục cache (khoá, gói, ref, dung lượng, tuổi).
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { dirBytes, ensureCached, hashTree, listWorkspacePkgs } from "./evotest-cache.lib";
import {
  type BuildStat,
  buildKey,
  srcId as makeSrcId,
  pkgDirOf,
  sha256,
  summarizeStats,
} from "./evotest-cache.rules";

const ROOT_FILES = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "tsconfig.base.json",
  "bunfig.toml",
];

function computeSrcId(root: string): string {
  const v = existsSync(join(root, "VERSION"))
    ? readFileSync(join(root, "VERSION"), "utf8")
    : undefined;
  return makeSrcId(v, () => hashTree(root, ["apps", "packages", ...ROOT_FILES]));
}

class BuildFailed extends Error {
  constructor(readonly code: number) {
    super(`build lỗi (mã ${code})`);
  }
}

/** Dựng thật: chạy `rsbuild build` trong thư mục app (script `build` của app trỏ về CLI này ⇒ không gọi lại `bun run build`, tránh vòng). */
async function plainBuild(appDir: string): Promise<number> {
  const p = Bun.spawn(["rsbuild", "build"], { cwd: appDir, stdout: "inherit", stderr: "inherit" });
  return (await p.exited) ?? 1;
}

function logStat(root: string, s: BuildStat): void {
  try {
    mkdirSync(join(root, ".data"), { recursive: true });
    appendFileSync(join(root, ".data", "build-cache.log"), `${JSON.stringify(s)}\n`);
  } catch {}
  console.log(
    `[build-cache] ${s.pkg}: ${s.result} (${(s.ms / 1000).toFixed(1)} s, chép ${(s.copyMs / 1000).toFixed(2)} s) key ${s.key.slice(0, 8)}`,
  );
}

/** Gọi từ script `build` của app (cwd = thư mục app, gốc repo = ../..): `bun ../../tools/scripts/src/evotest-cache.ts app-build`. */
async function build(): Promise<number> {
  const appDir = process.cwd();
  const root = resolve(appDir, "../..");
  const cache = process.env.EVO_BUILD_CACHE;
  const pkg = (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { name: string })
    .name;
  const pkgDir = existsSync(join(root, "bun.lock"))
    ? pkgDirOf(listWorkspacePkgs(root), pkg)
    : undefined;
  if (!cache || !pkgDir) return plainBuild(appDir); // không cache / không phải gốc repo ⇒ hành vi cũ
  const dist = resolve(appDir, process.env.E2E_DIST_DIR || "dist");
  const id = process.env.EVO_SRC_ID || computeSrcId(root);
  const key = buildKey({
    pkg,
    srcId: id,
    lockHash: sha256(readFileSync(join(root, "bun.lock"))),
    toolchain: `bun-${Bun.version}`,
    env: process.env,
  });
  const t0 = performance.now();
  try {
    const r = await ensureCached({
      root: cache,
      key,
      ref: id,
      produce: async (tmp) => {
        rmSync(dist, { recursive: true, force: true });
        const code = await plainBuild(appDir);
        if (code !== 0) throw new BuildFailed(code);
        cpSync(dist, join(tmp, "dist"), { recursive: true });
        writeFileSync(
          join(tmp, "meta.json"),
          JSON.stringify({ pkg, srcId: id, at: new Date().toISOString() }),
        );
      },
    });
    const t1 = performance.now();
    if (!r.built) {
      rmSync(dist, { recursive: true, force: true });
      cpSync(join(r.dir, "dist"), dist, { recursive: true });
    }
    logStat(root, {
      pkg,
      key,
      result: r.built ? "miss" : r.waited ? "wait" : "hit",
      ms: t1 - t0,
      copyMs: r.built ? 0 : performance.now() - t1,
    });
    return 0;
  } catch (e) {
    if (e instanceof BuildFailed) return e.code;
    throw e;
  }
}

function report(): void {
  const f = join(process.cwd(), ".data", "build-cache.log");
  const stats = existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as BuildStat)
    : [];
  console.log(summarizeStats(stats));
}

function status(): void {
  const cache = process.env.EVO_BUILD_CACHE;
  if (!cache || !existsSync(cache)) return void console.log("build-cache: trống");
  for (const n of readdirSync(cache).filter((x) => !x.startsWith("."))) {
    const d = join(cache, n);
    const meta = existsSync(join(d, "meta.json"))
      ? (JSON.parse(readFileSync(join(d, "meta.json"), "utf8")) as { pkg?: string; srcId?: string })
      : {};
    console.log(
      `${n}  ${meta.pkg ?? "?"}  ${meta.srcId ?? "?"}  ${(dirBytes(d) / 1e6).toFixed(1)} MB`,
    );
  }
}

const [cmd] = process.argv.slice(2);
if (import.meta.main) {
  if (cmd === "app-build") process.exit(await build());
  else if (cmd === "src-id") console.log(computeSrcId(process.cwd()));
  else if (cmd === "report") report();
  else if (cmd === "status") status();
  else {
    console.error("dùng: evotest-cache.ts app-build (từ thư mục app) | src-id | report | status");
    process.exit(2);
  }
}

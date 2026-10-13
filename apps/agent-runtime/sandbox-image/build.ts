// HUB-BR-33 · WRK-FR-28 · ADR-0011 #5 · plan-runtime §5.10 — `bun run sandbox:image`: dựng
// `ai-autofix-sandbox:<semver>` từ `Dockerfile` cạnh file này. bun = phiên bản `packageManager` ở
// `package.json` gốc; SHA256 lấy từ SHASUMS256.txt của bản phát hành bun (kiểm trong Dockerfile).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SANDBOX_IMAGE } from "../scripts/run";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

/** `"bun@1.3.14"` → `"1.3.14"`; sai dạng ⇒ lỗi (không đoán phiên bản). */
export function bunVersion(packageManager: unknown): string {
  const m = typeof packageManager === "string" && /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager);
  if (!m?.[1]) throw new Error(`packageManager không phải bun@x.y.z: ${String(packageManager)}`);
  return m[1];
}

/** Dòng `<sha256>  <file>` của SHASUMS256.txt → sha của `file`. */
export function shaFor(shasums: string, file: string): string {
  for (const line of shasums.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === file && sha && /^[0-9a-f]{64}$/.test(sha)) return sha;
  }
  throw new Error(`không thấy SHA256 của ${file}`);
}

export function buildArgv(version: string, sha: string, tag = SANDBOX_IMAGE): string[] {
  return [
    "docker",
    "build",
    "--build-arg",
    `BUN_VERSION=${version}`,
    "--build-arg",
    `BUN_SHA256=${sha}`,
    "-t",
    tag,
    HERE.split("\\").join("/"),
  ];
}

async function main(): Promise<number> {
  const pkg = (await Bun.file(resolve(ROOT, "package.json")).json()) as {
    packageManager?: unknown;
  };
  const version = bunVersion(pkg.packageManager);
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tải ${url} lỗi HTTP ${res.status}`);
  const arch = process.arch === "arm64" ? "aarch64" : "x64"; // = TARGETARCH mặc định của build
  const sha = shaFor(await res.text(), `bun-linux-${arch}.zip`);
  const p = Bun.spawnSync(buildArgv(version, sha), { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) return p.exitCode ?? 1;
  const size = Bun.spawnSync([
    "docker",
    "image",
    "inspect",
    SANDBOX_IMAGE,
    "--format",
    "{{.Size}}",
  ]);
  const mb = Math.round(Number(size.stdout.toString().trim()) / 1024 / 1024);
  console.log(`${SANDBOX_IMAGE} (bun ${version}) — ${mb} MB`);
  return 0;
}

if (import.meta.main) process.exit(await main());

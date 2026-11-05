// tool-evotest-fast: in MỘT bản tóm tắt gọn của lượt evotest từ console.log (run-tests.ps1 gọi cuối lượt; chạy tay được).
//   bun tools/scripts/src/evotest-summary.ts --step int --commit abc --exit 0 --wall 41 [--phases prep=2,push=3] --out <thư mục log> [--log <console.log>…]
// Mặc định đọc <out>/console.log, hoặc <out>/*/console.log (lượt chia slot). Ghi thêm <out>/summary.compact.txt.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatSummary } from "./evotest-summary.rules";

export function readLogs(out: string): string[] {
  const own = join(out, "console.log");
  if (existsSync(own)) return [readFileSync(own, "utf8")];
  if (!existsSync(out)) return [];
  return readdirSync(out, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(out, d.name, "console.log")))
    .map((d) => readFileSync(join(out, d.name, "console.log"), "utf8"));
}

export function parsePhases(s: string | undefined): Record<string, number> {
  const o: Record<string, number> = {};
  for (const kv of (s ?? "").split(",")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined && Number.isFinite(Number(v))) o[k] = Number(v);
  }
  return o;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const get = (n: string, d = "") => {
    const i = a.indexOf(`--${n}`);
    return i >= 0 && a[i + 1] !== undefined ? (a[i + 1] as string) : d;
  };
  const out = get("out", ".");
  const lines = formatSummary({
    step: get("step", "?"),
    commit: get("commit", "?"),
    exit: Number(get("exit", "0")),
    wallS: Number(get("wall", "0")),
    phases: parsePhases(get("phases")),
    logPath: out,
    logs: readLogs(out),
  });
  try {
    writeFileSync(join(out, "summary.compact.txt"), `${lines.join("\n")}\n`);
  } catch {}
  console.log(lines.join("\n"));
}

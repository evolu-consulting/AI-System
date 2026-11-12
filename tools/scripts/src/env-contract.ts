// `bun run check:env-contract` — CHỈ ĐỌC file trong repo: mỗi kit deploy phải tự đặt các biến trong deploy/env-contract.json
// (mặc định trong code sẽ âm thầm tắt tính năng). Thoát 1 nếu thiếu. Chênh lệch giữa hai kit chỉ báo, không làm đỏ.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Contract,
  checkContract,
  parseShNames,
  parseTemplateNames,
  renderResult,
} from "./env-contract.rules";
import { repoRoot } from "./lib/git";

export function runEnvContract(root = repoRoot()): { ok: boolean; lines: string[] } {
  const c = JSON.parse(readFileSync(join(root, "deploy/env-contract.json"), "utf8")) as Contract;
  const byKit: Record<string, Set<string>> = {};
  for (const [kit, files] of Object.entries(c.kitFiles)) {
    const names = new Set<string>();
    for (const f of files) {
      const p = join(root, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      for (const n of f.endsWith(".template") ? parseTemplateNames(text) : parseShNames(text))
        names.add(n);
    }
    byKit[kit] = names;
  }
  const r = checkContract(c, byKit);
  return { ok: r.ok, lines: renderResult(r) };
}

if (import.meta.main) {
  const r = runEnvContract();
  console.log(r.ok ? "env-contract: OK" : "env-contract: THIẾU biến hợp đồng");
  for (const l of r.lines) console.log(`  ${l}`);
  process.exit(r.ok ? 0 : 1);
}

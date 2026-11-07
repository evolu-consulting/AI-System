// CR-125 · m3 · I/O dùng chung của module:index / check:modules / module:new (đọc cây thư mục `modules/`).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanNodePaths } from "./modules-tool.rules";

export const MODULES_DIR = join(import.meta.dir, "../../../packages/contracts/src/modules");
export const INDEX_FILE = join(MODULES_DIR, "index.generated.ts");

/** `<app>/<node>/node.ts` có thật trên đĩa. */
export function readNodeTree(): Map<string, string[]> {
  const rel: string[] = [];
  for (const app of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    for (const node of readdirSync(join(MODULES_DIR, app.name), { withFileTypes: true }))
      if (node.isDirectory() && existsSync(join(MODULES_DIR, app.name, node.name, "node.ts")))
        rel.push(`${app.name}/${node.name}/node.ts`);
  }
  return scanNodePaths(rel);
}

export function readModuleSrcs(apps: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of apps) {
    const f = join(MODULES_DIR, a, "module.ts");
    if (existsSync(f)) out.set(a, readFileSync(f, "utf8"));
  }
  return out;
}

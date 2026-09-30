import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  workspaces: string[];
};
const SKIP = new Set(["packages/config"]); // không có code
const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);
const isCode = (f: string) => /\.tsx?$/.test(f) && !isTest(f) && !/\.d\.ts$|\.gen\.ts$/.test(f);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist" || n === "__fixtures__") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const dirs = pkg.workspaces.flatMap((g) => {
  const base = g.replace(/\/\*$/, "");
  return readdirSync(join(ROOT, base)).map((n) => `${base}/${n}`);
});
const missing: string[] = [];
for (const d of dirs) {
  if (SKIP.has(d) || !existsSync(join(ROOT, d, "package.json"))) continue;
  const files = walk(join(ROOT, d));
  if (files.some(isCode) && !files.some(isTest)) missing.push(d);
}
if (missing.length) {
  console.error(`Workspace có code nhưng chưa có test: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`ac07.check OK (${dirs.length} workspace)`);

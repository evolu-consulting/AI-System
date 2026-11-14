// `bun run check:button-gap` (CR-163): nút cùng một hàng phải cách nhau (gap-2; cụm nhỏ tối thiểu gap-1.5).
import { readFileSync } from "node:fs";
import { findGapViolations, type Spaced, spacedClasses } from "./check-button-gap.rules";
import { git, repoRoot } from "./lib/git";

const ROOTS = [
  "apps/workspace-web/",
  "apps/admin-web/",
  "apps/chat-web/",
  "apps/studio-web/",
  "packages/web-kit/",
  "packages/ui/",
];

function main(): number {
  const root = repoRoot();
  const ls = git(["ls-files", "--", "*.tsx"], root);
  if (!ls.ok) throw new Error("check:button-gap: không đọc được git index");
  const files = ls.out
    .split("\n")
    .filter((f) => ROOTS.some((r) => f.startsWith(r)) && !f.endsWith(".test.tsx"));
  const css = git(["ls-files", "--", "*.css"], root)
    .out.split("\n")
    .filter((f) => ROOTS.some((r) => f.startsWith(r)));
  const spaced: Spaced = { gap: new Set(), margin: new Set() };
  for (const f of css) {
    const sc = spacedClasses(readFileSync(`${root}/${f}`, "utf8"));
    for (const c of sc.gap) spaced.gap.add(c);
    for (const c of sc.margin) spaced.margin.add(c);
  }
  const bad: string[] = [];
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(`${root}/${f}`, "utf8");
    } catch {
      continue;
    }
    for (const v of findGapViolations(src, spaced))
      bad.push(`${f}:${v.line} <${v.tag}> có ≥ 2 nút nhưng thiếu gap-*/space-x-*`);
  }
  if (bad.length) {
    console.error(
      `${bad.join("\n")}\ncheck:button-gap: ${bad.length} chỗ vi phạm (thêm gap-2; cố ý thì ghi "button-gap-ok")`,
    );
    return 1;
  }
  console.log("check:button-gap OK");
  return 0;
}

if (import.meta.main) process.exit(main());

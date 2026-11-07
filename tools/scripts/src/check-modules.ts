// CR-125 · m3 · MOD-FR-06 · `bun run check:modules`: kiểm tĩnh sổ module, không hub/DB — index tự sinh còn mới (MOD_INDEX_STALE),
// mỗi node.ts nằm trong module.ts, `moduleIssues` với binding "dễ tính" (chỉ còn luật không cần runtime, vd MOD_DUP).
import { readFileSync } from "node:fs";
import { MODULES, moduleIssues } from "@ai/contracts/modules";
import { INDEX_FILE, readModuleSrcs, readNodeTree } from "./modules-tool.fs";
import { formatIssue, staticBound, staticIssues } from "./modules-tool.rules";

function main(): void {
  const nodes = readNodeTree();
  const issues = [
    ...staticIssues({
      nodes,
      moduleSrc: readModuleSrcs(nodes.keys()),
      currentIndex: readFileSync(INDEX_FILE, "utf8"),
    }),
    ...moduleIssues(MODULES, staticBound(MODULES)),
  ];
  for (const i of issues) console.error(formatIssue(i));
  if (issues.length > 0) {
    console.error(`check:modules: ${issues.length} lỗi sổ module (CR-125)`);
    process.exit(1);
  }
  console.log(`check:modules: ${MODULES.length} module, sổ khớp thư mục`);
}

if (import.meta.main) main();

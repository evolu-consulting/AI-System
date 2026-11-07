// CR-125 · m3 · MOD-FR-06 · `bun run module:index`: sinh packages/contracts/src/modules/index.generated.ts từ thư mục
// `modules/<app>/<node>/node.ts`. Luật ở modules-tool.rules.ts (unit: modules-tool.rules.test.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { INDEX_FILE, readNodeTree } from "./modules-tool.fs";
import { renderIndex } from "./modules-tool.rules";

export function generateIndex(): boolean {
  const next = renderIndex([...readNodeTree().keys()]);
  let prev = "";
  try {
    prev = readFileSync(INDEX_FILE, "utf8");
  } catch {}
  if (prev === next) return false;
  writeFileSync(INDEX_FILE, next);
  return true;
}

if (import.meta.main) {
  console.log(
    generateIndex() ? "module:index: đã cập nhật index.generated.ts" : "module:index: không đổi",
  );
}

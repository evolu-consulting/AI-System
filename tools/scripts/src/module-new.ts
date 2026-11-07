// CR-125 · m3 · MOD-FR-06 · `bun run module:new <app> <node>`: dựng node.ts + test + (tạo/cập nhật) module.ts, in đường dẫn binding (hub-api)
// và panel tuỳ chọn (admin-web) cần tự viết, rồi chạy module:index. Luật ở modules-tool.rules.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateIndex } from "./module-index";
import { MODULES_DIR } from "./modules-tool.fs";
import {
  addNodeToModule,
  moduleSource,
  nameError,
  nodeSource,
  nodeTestSource,
} from "./modules-tool.rules";

function main(): void {
  const [app = "", node = ""] = process.argv.slice(2);
  const err = nameError("app", app) ?? nameError("node", node);
  if (err) {
    console.error(`module:new: ${err}\nDùng: bun run module:new <app> <node>`);
    process.exit(1);
  }
  const dir = join(MODULES_DIR, app, node);
  if (existsSync(join(dir, "node.ts"))) {
    console.error(`module:new: node «${app}.${node}» đã có — không ghi đè.`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "node.ts"), nodeSource(app, node));
  writeFileSync(join(dir, "node.test.ts"), nodeTestSource(app, node));
  const modFile = join(MODULES_DIR, app, "module.ts");
  writeFileSync(
    modFile,
    existsSync(modFile)
      ? addNodeToModule(readFileSync(modFile, "utf8"), node)
      : moduleSource(app, node),
  );
  generateIndex();
  console.log(
    `module:new: đã tạo packages/contracts/src/modules/${app}/${node}/node.ts (+ node.test.ts)`,
  );
  console.log(`  cần viết tiếp: apps/hub-api/src/packs/${app}/nodes/${node}/binding.ts`);
  console.log(`  tuỳ chọn (panel riêng): apps/admin-web/src/modules/${app}/${node}/Panel.tsx`);
}

if (import.meta.main) main();

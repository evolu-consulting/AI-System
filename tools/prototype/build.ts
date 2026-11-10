// `bun run proto:build <thư-mục-CR>` — đọc <dir>/prototype.json, ghi <dir>/prototype.html
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPrototype } from "./render";

const dir = process.argv[2];
if (!dir) {
  console.error("Cách dùng: bun run proto:build docs/specs/<CR>");
  process.exit(2);
}
try {
  const html = renderPrototype(JSON.parse(readFileSync(join(dir, "prototype.json"), "utf8")));
  const out = join(dir, "prototype.html");
  writeFileSync(out, html);
  console.log(`${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error(`proto:build lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

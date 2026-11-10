// `bun run proto:build <thư-mục-CR>` — kiểm <dir>/prototype.json rồi ghi <dir>/prototype.html
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadChecked } from "./cli";
import { renderPrototype } from "./render";

const dir = process.argv[2];
const p = loadChecked(dir, "bun run proto:build docs/specs/<CR>");
const html = renderPrototype(p);
const out = join(dir as string, "prototype.html");
writeFileSync(out, html);
console.log(`${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

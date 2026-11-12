// `bun run proto:feedback <thư-mục-CR> <prototype-feedback.json>` — nối «Quyết định từ bản mẫu» vào spec.md (hoặc tasks.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, loadPrototype } from "./cli";
import { appendDecision, feedbackSchema, staleError } from "./feedback.rules";

const [dir, file] = process.argv.slice(2);
const usage = "bun run proto:feedback docs/specs/<CR> <prototype-feedback.json>";
const p = loadPrototype(dir, usage);
if (!file) fail(`Cách dùng: ${usage}`, 2);
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  fail(`Không đọc được ${file}: ${e instanceof Error ? e.message : String(e)}`);
}
const parsed = feedbackSchema.safeParse(raw);
if (!parsed.success) fail("Tệp góp ý không đúng mẫu — hãy dùng nút «Xuất góp ý» trong bản mẫu.");
const stale = staleError(parsed.data, p);
if (stale) fail(stale);

const spec = join(dir as string, "spec.md");
const target = existsSync(spec) ? spec : join(dir as string, "tasks.md");
const before = existsSync(target) ? readFileSync(target, "utf8") : "";
const after = appendDecision(before, parsed.data, new Date().toISOString().slice(0, 10));
if (after === null) fail(`Góp ý này đã được ghi vào ${target} rồi — không ghi lại.`, 0);
writeFileSync(target, after);
console.log(`Đã ghi «Quyết định từ bản mẫu» vào ${target}`);

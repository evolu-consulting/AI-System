// CR-114 hub-eval · `bun run eval:log-format [--complex] [--models haiku,sonnet] [--reps 2] [--dry-run]`
// --dry-run: chỉ sinh log và in kích thước từng khuôn (không gọi model). Chạy thật gọi `claude -p` (tốn hạn mức gói);
// số lời gọi in trước khi chạy. Đường CLI: `AI_SUB_CLI_PATH` hoặc `claude` trên PATH.
import { FORMATS, generate } from "./generate";
import { claudeCall, formatRows, measure, plannedCalls } from "./measure";

const argv = process.argv.slice(2);
const flag = (k: string): boolean => argv.includes(`--${k}`);
const val = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const complex = flag("complex");
const models = (val("models") ?? "haiku,sonnet")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const reps = Number(val("reps") ?? (complex ? "2" : "1"));
if (!Number.isInteger(reps) || reps < 1 || models.length === 0) {
  console.error("--reps phải là số nguyên ≥ 1 và --models không rỗng");
  process.exit(2);
}

const ds = generate(complex);
console.log(`log ${complex ? "phức tạp" : "đơn giản"}: ${ds.events} sự kiện`);
for (const f of FORMATS) console.log(`  ${f.padEnd(12)} ${ds.formats[f].length} ký tự`);
if (flag("dry-run")) process.exit(0);

const cli = Bun.which(process.env.AI_SUB_CLI_PATH?.trim() || "claude");
if (!cli) {
  console.error("không tìm thấy CLI `claude` (đặt AI_SUB_CLI_PATH)");
  process.exit(2);
}
const opts = { complex, models, reps };
console.log(`đo: ${plannedCalls(opts)} lời gọi model (${models.join(", ")}, ${reps} lần/khuôn)`);
console.log(formatRows(await measure(opts, claudeCall(cli), ds)));

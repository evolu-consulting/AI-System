// `bun run openspec:check|openspec:pending|openspec:archive` — Delta kiểu OpenSpec (ADR-0032), không dùng CLI OpenSpec.
//   check [lát…]      kiểm Delta trong docs/specs/<lát>/tasks.md (mặc định: lát đổi so với platform/gd0 + nhánh slice/<tên>)
//   pending           liệt kê lát "chưa gộp" và file docs/current đích (hỗ trợ gộp cuối đợt)
//   archive <lát> [--dot <tên>]  đổi dòng trạng thái thành "đã gộp <hôm nay>" (KHÔNG sửa docs/current)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markMerged, parseDelta, validateDelta } from "./openspec.rules";

const BASE = "platform/gd0";

const tasksPath = (root: string, slice: string) => join(root, "docs", "specs", slice, "tasks.md");

/** Kiểm một lát; trả danh sách lỗi đã định dạng `file:dòng — nội dung`. */
export function checkSlice(root: string, slice: string): string[] {
  const rel = `docs/specs/${slice}/tasks.md`;
  const f = tasksPath(root, slice);
  if (!existsSync(f))
    return [
      `${rel}:1 — lát "${slice}" chưa có tasks.md (Luật 0b: mỗi lát đúng một docs/specs/<lát>/tasks.md)`,
    ];
  const p = parseDelta(readFileSync(f, "utf8"));
  const exists = (r: string) => existsSync(join(root, "docs", "current", r));
  return validateDelta(p, exists).map((i) => `${rel}:${i.line} — ${i.msg}`);
}

export interface Pending {
  slice: string;
  files: string[];
  noChange: boolean;
}

export function listPending(root: string): Pending[] {
  const dir = join(root, "docs", "specs");
  if (!existsSync(dir)) return [];
  const out: Pending[] = [];
  for (const slice of readdirSync(dir).sort()) {
    const f = tasksPath(root, slice);
    if (!existsSync(f)) continue;
    const p = parseDelta(readFileSync(f, "utf8"));
    if (p.state !== "chưa gộp") continue;
    const files = [...new Set(p.blocks.filter((b) => b.file).map((b) => `${b.kind} ${b.file}`))];
    out.push({ slice, files, noChange: !!p.noChange });
  }
  return out;
}

export function archiveSlice(
  root: string,
  slice: string,
  date: string,
  wave?: string,
): { ok: boolean; msg: string } {
  const errs = checkSlice(root, slice);
  if (errs.length)
    return { ok: false, msg: `không đánh dấu được, Delta chưa đạt:\n${errs.join("\n")}` };
  const f = tasksPath(root, slice);
  const text = readFileSync(f, "utf8");
  const p = parseDelta(text);
  if (p.state === "đã gộp")
    return { ok: true, msg: `${slice}: đã ở trạng thái "đã gộp", không đổi` };
  const next = markMerged(text, p, date, wave);
  if (next === null) return { ok: false, msg: "không thấy dòng Trạng thái gộp" };
  writeFileSync(f, next);
  return {
    ok: true,
    msg: `${slice}: đã gộp ${date} (nhớ đã áp Delta vào docs/current — lệnh này chỉ ghi sổ)`,
  };
}

function git(root: string, ...a: string[]): string {
  const p = Bun.spawnSync(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? `${p.stdout}`.trim() : "";
}

/** Lát đổi so với BASE: thư mục docs/specs/<lát>/ có thay đổi + tên nhánh slice/<lát>. */
export function changedSlices(root: string): string[] {
  const set = new Set<string>();
  const mb = git(root, "merge-base", BASE, "HEAD");
  if (mb) {
    for (const l of git(root, "diff", "--name-only", mb).split(/\r?\n/)) {
      const m = /^docs\/specs\/([^/]+)\//.exec(l);
      if (m?.[1]) set.add(m[1]);
    }
  }
  const br = /^slice\/(.+)$/.exec(git(root, "rev-parse", "--abbrev-ref", "HEAD"));
  if (br?.[1]) set.add(br[1]);
  return [...set].sort();
}

function cmdCheck(root: string, args: string[]): number {
  const slices = args.length ? args : changedSlices(root);
  if (!slices.length) {
    console.log(`openspec:check: không có lát nào đổi so với ${BASE}`);
    return 0;
  }
  const errs = slices.flatMap((s) => checkSlice(root, s));
  if (errs.length) {
    console.error(`openspec:check: ${errs.length} lỗi Delta\n${errs.join("\n")}`);
    console.error('Mẫu và quy tắc: docs/current/README.md mục "Định dạng Delta".');
    return 1;
  }
  console.log(`openspec:check: Delta OK (${slices.join(", ")})`);
  return 0;
}

function cmdPending(root: string): number {
  const list = listPending(root);
  if (!list.length) console.log('openspec:pending: không có lát "chưa gộp"');
  for (const x of list)
    console.log(
      `${x.slice}: ${x.noChange ? "(không đổi hành vi — chỉ cần archive)" : x.files.join("; ")}`,
    );
  return 0;
}

export function main(argv: string[], root: string): number {
  const [cmd, ...rest] = argv;
  if (cmd === "check") return cmdCheck(root, rest);
  if (cmd === "pending") return cmdPending(root);
  if (cmd === "archive") {
    const di = rest.indexOf("--dot");
    const wave = di >= 0 ? rest[di + 1] : undefined;
    const slice = rest.find((a, i) => !a.startsWith("--") && i !== di + 1);
    if (!slice) {
      console.error("dùng: openspec:archive <lát> [--dot <tên đợt>]");
      return 1;
    }
    const r = archiveSlice(root, slice, new Date().toISOString().slice(0, 10), wave);
    (r.ok ? console.log : console.error)(`openspec:archive: ${r.msg}`);
    return r.ok ? 0 : 1;
  }
  console.error("dùng: openspec check [lát…] | pending | archive <lát>");
  return 1;
}

if (import.meta.main) {
  const top = git(process.cwd(), "rev-parse", "--show-toplevel") || process.cwd();
  process.exit(main(process.argv.slice(2), top));
}

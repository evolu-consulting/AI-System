// Git merge driver cho locale i18n JSON: `bun tools/scripts/src/json-merge-driver.ts %O %A %B %P`
// (.gitattributes: `packages/i18n/locales/**/*.json merge=i18njson`; cấu hình git do setup-merge-driver.ts).
// Gộp theo key (json-merge.rules.ts). %A (ours) được ghi đè bằng kết quả. Exit 0 = gộp sạch.
// Conflict thật (cùng key đổi khác nhau, xoá vs sửa) hoặc JSON hỏng ⇒ chạy `git merge-file` để %A có dấu
// conflict chuẩn (<<<<<<< / ======= / >>>>>>>), in danh sách key xung đột ra stderr, exit 1.
import { readFileSync, writeFileSync } from "node:fs";
import { mergeJsonText } from "./json-merge.rules";

if (import.meta.main) {
  const [base, ours, theirs, pathName = ours] = process.argv.slice(2);
  if (!base || !ours || !theirs) {
    console.error("dùng: json-merge-driver <base> <ours> <theirs> [path]");
    process.exit(2);
  }
  const read = (f: string) => readFileSync(f, "utf8");
  const r = mergeJsonText(read(base), read(ours), read(theirs));
  if (r.text !== null) {
    writeFileSync(ours, r.text);
    process.exit(0);
  }
  const why = r.error ?? `key xung đột: ${r.conflicts.join(", ")}`;
  Bun.spawnSync([
    "git",
    "merge-file",
    "-L",
    "ours",
    "-L",
    "base",
    "-L",
    "theirs",
    ours,
    base,
    theirs,
  ]);
  console.error(
    `i18njson: conflict thật trong ${pathName} — ${why}. Sửa tay theo dấu conflict rồi git add.`,
  );
  process.exit(1);
}

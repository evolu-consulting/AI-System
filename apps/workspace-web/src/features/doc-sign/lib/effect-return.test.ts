// CR-182 · fix-cr182-ui · lỗi 2: `useEffect(() => el.scrollTo(...))` trả Promise trên Chromium mới ⇒ React coi là hàm dọn ⇒ «i is not a function».
// Quét nguồn: thân effect dạng mũi tên không ngoặc chỉ được là `setXxx(...)` (trả void) hoặc hàm dọn `() => ...`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

describe("useEffect không trả giá trị lạ", () => {
  const bad: string[] = [];
  for (const dir of ["doc-sign", "partner-sign", "settings"]) {
    for (const f of walk(join(root, dir))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = /useEffect\(\(\) =>\s*(?!\{|\(\) =>|set[A-Z])\S/.exec(line);
          if (m) bad.push(`${f}:${i + 1}`);
        });
    }
  }
  test("effect dạng mũi tên không ngoặc nhọn chỉ là setState hoặc hàm dọn", () => {
    expect(bad).toEqual([]);
  });
});

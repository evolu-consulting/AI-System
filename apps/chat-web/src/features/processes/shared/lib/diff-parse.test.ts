// HUB-FR-119 · P-c1 · parseDiff / tailLines thuần.
import { describe, expect, test } from "bun:test";
import { parseDiff, tailLines } from "./diff-parse";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 keep
-old
+new
\\ No newline at end of file
diff --git a/img.png b/img.png
new file mode 100644
Binary files /dev/null and b/img.png differ
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
@@ -1 +1,2 @@
 x
+y
`;

describe("parseDiff", () => {
  test("rỗng ⇒ không file", () => {
    expect(parseDiff("").files).toEqual([]);
  });
  test("đếm +/−, hunk, nhị phân, đổi tên", () => {
    const p = parseDiff(DIFF);
    expect(p.files.map((f) => f.path)).toEqual(["src/a.ts", "img.png", "new.ts"]);
    const [a, img, ren] = p.files;
    expect([a?.additions, a?.deletions]).toEqual([1, 1]);
    expect(a?.hunks[0]?.lines.map((l) => l.kind)).toEqual(["ctx", "del", "add", "note"]);
    expect(img?.binary).toBe(true);
    expect(img?.status).toBe("added");
    expect(img?.hunks).toEqual([]);
    expect(ren?.status).toBe("renamed");
    expect(ren?.oldPath).toBe("old.ts");
    expect(p.truncated).toBe(false);
  });
  test("cắt theo max nhưng vẫn đếm +/− và đủ file", () => {
    const p = parseDiff(DIFF, 2);
    expect(p.truncated).toBe(true);
    expect(p.shownLines).toBe(2);
    expect(p.rest).toBeGreaterThan(0);
    expect(p.files).toHaveLength(3);
    expect(p.files[0]?.additions).toBe(1);
    expect(p.files[2]?.additions).toBe(1);
  });
  test("CRLF được chấp nhận", () => {
    const p = parseDiff(DIFF.replace(/\n/g, "\r\n"));
    expect(p.files[0]?.hunks[0]?.lines[1]?.text).toBe("old");
  });
});

describe("tailLines", () => {
  test("lấy n dòng cuối, bỏ dòng trống cuối", () => {
    expect(tailLines("a\nb\nc\n", 2)).toBe("b\nc");
    expect(tailLines("a", 30)).toBe("a");
  });
});

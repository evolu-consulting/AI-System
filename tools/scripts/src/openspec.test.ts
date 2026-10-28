import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSlice, checkSlice, listPending } from "./openspec";

let root = "";
const spec = (slice: string, body: string) => {
  mkdirSync(join(root, "docs", "specs", slice), { recursive: true });
  writeFileSync(join(root, "docs", "specs", slice, "tasks.md"), body);
};
const delta = (status: string, rest: string) =>
  `## Delta (so với docs/current)\nTrạng thái gộp: ${status}\n${rest}\n`;
const BLOCK = "### MODIFIED sht/a.md\n#### Yêu cầu: X\n- Kịch bản: khi A thì B\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openspec-"));
  mkdirSync(join(root, "docs", "current", "sht"), { recursive: true });
  writeFileSync(join(root, "docs", "current", "sht", "a.md"), "# a\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("openspec CLI core", () => {
  test("checkSlice: tasks.md thiếu, hợp lệ, file lạ", () => {
    expect(checkSlice(root, "none")[0]).toContain("chưa có tasks.md");
    spec("ok", delta("chưa gộp", BLOCK));
    expect(checkSlice(root, "ok")).toEqual([]);
    spec("bad", delta("chưa gộp", BLOCK.replace("a.md", "z.md")));
    expect(checkSlice(root, "bad")[0]).toMatch(/^docs\/specs\/bad\/tasks\.md:\d+ — .*z\.md/);
  });

  test("listPending chỉ lát chưa gộp, kèm file đích", () => {
    spec("p1", delta("chưa gộp", BLOCK));
    spec("p2", delta("chưa gộp", "Không thay đổi hành vi (lý do: test)"));
    spec("done", delta("đã gộp 2026-10-01", BLOCK));
    spec("legacy", "# không có Delta\n");
    expect(listPending(root)).toEqual([
      { slice: "p1", files: ["MODIFIED sht/a.md"], noChange: false },
      { slice: "p2", files: [], noChange: true },
    ]);
  });

  test("archiveSlice đổi trạng thái; từ chối khi check lỗi; không đụng docs/current", () => {
    spec("p1", delta("chưa gộp", BLOCK));
    const r = archiveSlice(root, "p1", "2026-10-28", "W1");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "docs/specs/p1/tasks.md"), "utf8")).toContain(
      "Trạng thái gộp: đã gộp 2026-10-28 (đợt W1)",
    );
    expect(readFileSync(join(root, "docs/current/sht/a.md"), "utf8")).toBe("# a\n");
    expect(archiveSlice(root, "p1", "2026-10-29").msg).toContain("không đổi");
    spec("bad", delta("chưa gộp", "### MODIFIED sht/a.md\n#### Yêu cầu: X\n"));
    expect(archiveSlice(root, "bad", "2026-10-28").ok).toBe(false);
    expect(readFileSync(join(root, "docs/specs/bad/tasks.md"), "utf8")).toContain("chưa gộp");
  });
});

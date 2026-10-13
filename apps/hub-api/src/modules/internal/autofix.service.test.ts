// HUB-FR-128 · HUB-FR-130 · P-c1 B4 · hàm thuần của kênh báo tự-sửa: `parseReport` (400/413) + `fileNames`.
import { describe, expect, it } from "bun:test";
import { fileNames, parseReport } from "./autofix.service";

const RUN = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ok = {
  status: "ok",
  branch: `ai/${RUN}/fix`,
  base_sha: "1".repeat(40),
  head_sha: "2".repeat(40),
  diff: "diff --git a/x b/x\n",
  diff_stats: { files: 1, insertions: 1, deletions: 0, bytes: 19 },
  test: null,
  failures: [],
  commands: [],
};

describe("parseReport", () => {
  it("HUB-FR-130 · hợp lệ ⇒ trả báo cáo", () => {
    expect(parseReport(JSON.stringify(ok))).toMatchObject({ status: "ok", branch: ok.branch });
  });
  it("HUB-FR-130 · không phải JSON / sai schema / ok mà diff rỗng ⇒ invalid", () => {
    expect(parseReport("{x")).toEqual({ kind: "invalid" });
    expect(parseReport(JSON.stringify({ ...ok, extra: 1 }))).toEqual({ kind: "invalid" });
    expect(parseReport(JSON.stringify({ ...ok, diff: "" }))).toEqual({ kind: "invalid" });
    expect(parseReport("null")).toEqual({ kind: "invalid" });
  });
  it("WRK-FR-29 · diff > 2 MiB (byte UTF-8) ⇒ too_large trước zod", () => {
    expect(parseReport(JSON.stringify({ ...ok, diff: "+".repeat(2_097_153) }))).toEqual({
      kind: "too_large",
    });
    // 699_051 × 3 byte ("ế") > 2 MiB dù số ký tự < trần.
    expect(parseReport(JSON.stringify({ ...ok, diff: "ế".repeat(699_051) }))).toEqual({
      kind: "too_large",
    });
  });
});

describe("fileNames", () => {
  it("PC-R12 · tên theo stage key + vòng", () => {
    expect(fileNames(`ai/${RUN}/fix-bug`, 3)).toEqual({
      diff: "fix-bug-r3.diff.txt",
      log: "fix-bug-r3-test.log.txt",
    });
  });
});

// HUB-FR-126 · PC-R01 · kiểm loại nguồn của stage tự-sửa.
import { describe, expect, it } from "bun:test";
import { autofixSourceKindMiss } from "./def.rules";

describe("autofixSourceKindMiss [HUB-FR-126]", () => {
  const kinds = new Map([
    ["repo", "git_remote"],
    ["loc", "local_path"],
    ["lib", "library"],
  ]);
  it("git_remote/local_path hợp lệ; library hoặc key lạ ⇒ path stage", () => {
    expect(
      autofixSourceKindMiss([{ autofix: { source_key: "repo" } }, { autofix: null }], kinds),
    ).toBeNull();
    expect(autofixSourceKindMiss([{ autofix: { source_key: "loc" } }], kinds)).toBeNull();
    expect(autofixSourceKindMiss([{}, { autofix: { source_key: "lib" } }], kinds)).toBe(
      "stages.1.autofix.source_key",
    );
    expect(autofixSourceKindMiss([{ autofix: { source_key: "x" } }], kinds)).toBe(
      "stages.0.autofix.source_key",
    );
  });
});

import { describe, expect, test } from "bun:test";
import { applyAllowlist, checkContractName, scanFile } from "./check-contract-name";
import { repoRoot } from "./lib/git";

describe("check-contract-name (CR-121 Q-4)", () => {
  test("bắt tự viết tên HĐ từ fields.title và đọc thô c.title", () => {
    const src = [
      "sql`select coalesce(nullif(c.fields -> 'title' ->> 'value', ''), c.number) from contracts.contracts c`",
      "sql`select c.title from contracts.contracts c`",
      'sql`select ${contractNameSql("c")} as title`',
      "// c.title chỉ trong comment",
    ].join("\n");
    expect(scanFile("adapters/x.repo.ts", src).map((f) => f.line)).toEqual([1, 2]);
  });
  test("allowlist: tối đa N lần cho file đã biết, dư ra là lỗi", () => {
    const f = (line: number) => ({ file: "adapters/upload-contract.repo.ts", line, msg: "x" });
    expect(applyAllowlist([f(1)])).toEqual([]);
    expect(applyAllowlist([f(1), f(2)]).map((x) => x.line)).toEqual([2]);
    expect(applyAllowlist([{ file: "adapters/other.repo.ts", line: 3, msg: "x" }])).toHaveLength(1);
  });
  test("mã nguồn gói contracts hiện tại sạch", () => {
    expect(checkContractName(repoRoot())).toEqual([]);
  });
});

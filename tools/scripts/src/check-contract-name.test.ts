import { describe, expect, test } from "bun:test";
import {
  applyAllowlist,
  checkContractName,
  checkContractNameTs,
  scanFile,
  scanTsFile,
} from "./check-contract-name";
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
  test("chế độ TS: bắt tự ghép tên/mã HĐ và fields.title.value", () => {
    const src = [
      "const a = k.number ?? k.title;",
      "const b = n.title ?? n.number;",
      "const c = d.fields.title.value;",
      "const d = c?.title ?? '';",
      "const ok = contractNameOf(k);",
      "// k.number ?? k.title trong comment",
    ].join("\n");
    expect(scanTsFile("x.ts", src).map((f) => f.line)).toEqual([1, 2, 3, 4]);
  });
  test("mã nguồn TS hub-api + workspace-web hiện tại sạch", () => {
    expect(checkContractNameTs(repoRoot())).toEqual([]);
  });
  test("mã nguồn gói contracts hiện tại sạch", () => {
    expect(checkContractName(repoRoot())).toEqual([]);
  });
});

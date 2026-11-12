import { describe, expect, test } from "bun:test";
import { checkContract, parseShNames, parseTemplateNames } from "./env-contract.rules";

describe("env-contract.rules", () => {
  test("parseShNames lấy heredoc, setkv, ensure, grep -q", () => {
    const sh = [
      "ensure HUB_A all",
      "grep -q '^DIFY_X=' .env || setkv DIFY_X http://x",
      "cat > .env <<EOF",
      "FOO=$(date)",
      "BAR=1",
      "EOF",
      "NOT_ENV=1",
    ].join("\n");
    const n = parseShNames(sh);
    expect([...n].sort()).toEqual(["BAR", "DIFY_X", "FOO", "HUB_A"]);
  });

  test("parseTemplateNames", () => {
    expect([...parseTemplateNames("# c\nA=\nb=\nC_1=\n")].sort()).toEqual(["A", "C_1"]);
  });

  test("checkContract báo thiếu và chênh lệch có allowDiff", () => {
    const c = {
      kitFiles: {},
      vars: [{ name: "X", kits: ["p", "s"] }],
      allowDiff: ["OK"],
    };
    const r = checkContract(c, {
      p: new Set(["X", "OK", "ONLY_P"]),
      s: new Set(["Y"]),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual({ s: ["X"] });
    expect(r.onlyIn.p).toEqual(["ONLY_P", "X"]);
    expect(r.onlyIn.s).toEqual(["Y"]);
  });
});

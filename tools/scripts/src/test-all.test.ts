// CR-092 · luật dựng danh sách bước `test:all`.
import { describe, expect, it } from "bun:test";
import { buildSteps, e2eSteps, parseArgs } from "./test-all.rules";

const CONFIGS = [
  "e2e\\P-a\\playwright.pa.config.ts",
  "playwright.config.ts",
  "e2e/chat/playwright.config.ts",
];

describe("CR-092 · test:all", () => {
  it("e2eSteps: chuẩn hoá dấu /, sắp xếp ổn định, mỗi cấu hình một bước", () => {
    expect(e2eSteps(CONFIGS).map((s) => s.name)).toEqual([
      "e2e:e2e/P-a/playwright.pa.config.ts",
      "e2e:e2e/chat/playwright.config.ts",
      "e2e:playwright.config.ts",
    ]);
    expect(e2eSteps(["e2e/x1/playwright.config.ts"])[0]?.cmd).toEqual([
      "bunx",
      "playwright",
      "test",
      "-c",
      "e2e/x1/playwright.config.ts",
    ]);
  });

  it("buildSteps mặc định: check → typecheck → unit → int → lock → python → mọi e2e", () => {
    const names = buildSteps(CONFIGS, { e2e: true, python: true }).map((s) => s.name);
    expect(names.slice(0, 6)).toEqual(["check", "typecheck", "unit", "int", "lock", "python"]);
    expect(names.filter((n) => n.startsWith("e2e:")).length).toBe(3);
  });

  it("--no-e2e, --no-python bỏ bước tương ứng; --only lọc theo tên hoặc tiền tố", () => {
    expect(parseArgs(["--no-e2e", "--no-python"])).toEqual({
      e2e: false,
      python: false,
      only: undefined,
    });
    expect(buildSteps(CONFIGS, parseArgs(["--no-e2e", "--no-python"])).map((s) => s.name)).toEqual([
      "check",
      "typecheck",
      "unit",
      "int",
      "lock",
    ]);
    expect(buildSteps(CONFIGS, parseArgs(["--only=e2e"])).length).toBe(3);
    expect(buildSteps(CONFIGS, parseArgs(["--only=unit"])).map((s) => s.name)).toEqual(["unit"]);
  });
});

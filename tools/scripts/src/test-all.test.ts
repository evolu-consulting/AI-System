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
      "bun",
      "tools/scripts/src/run-playwright.ts",
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

describe("GX · test:all trên máy thiếu công cụ / thiếu env", () => {
  it("envLocal: bước unit nạp .env.local tường minh (bun test không tự nạp)", () => {
    const cmd = (envLocal: boolean) =>
      buildSteps(CONFIGS, { e2e: false, python: false, envLocal }).find((s) => s.name === "unit")
        ?.cmd;
    expect(cmd(true)).toEqual(["bun", "--env-file=.env.local", "test"]);
    expect(cmd(false)).toEqual(["bun", "test"]);
  });

  it("#230 · thiếu docker/uv: typecheck chạy bản host, python + typecheck agent-runtime là bước BỊ CHẶN có lý do", () => {
    const steps = buildSteps(CONFIGS, { e2e: false, python: true, pyBlocked: "thiếu docker" });
    expect(steps.find((s) => s.name === "typecheck")?.cmd).toEqual([
      "bun",
      "run",
      "typecheck:host",
    ]);
    const blocked = steps.filter((s) => s.blocked).map((s) => [s.name, s.blocked]);
    expect(blocked).toEqual([
      ["typecheck:agent-runtime", "thiếu docker"],
      ["python", "thiếu docker"],
    ]);
    expect(buildSteps(CONFIGS, { e2e: false, python: true }).some((s) => s.blocked)).toBe(false);
  });
});

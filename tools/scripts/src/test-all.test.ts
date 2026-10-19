// CR-092 · luật dựng danh sách bước `test:all`. TS1: một bước e2e song song, bước cùng đợt chạy cùng lúc.
import { describe, expect, it } from "bun:test";
import { waves } from "./lib/run-steps";
import { buildSteps, e2eStep, parseArgs } from "./test-all.rules";

describe("CR-092 · test:all", () => {
  it("e2eStep: một bước chạy test-e2e-par; --only=e2e:<việc> chuyển thành --only=<việc>", () => {
    expect(e2eStep().cmd).toEqual(["bun", "tools/scripts/src/test-e2e-par.ts"]);
    expect(e2eStep("P-a").cmd).toEqual(["bun", "tools/scripts/src/test-e2e-par.ts", "--only=P-a"]);
  });

  it("buildSteps mặc định: check, typecheck, unit, int, lock, python, e2e (một bước)", () => {
    const names = buildSteps({ e2e: true, python: true }).map((s) => s.name);
    expect(names).toEqual(["check", "typecheck", "unit", "int", "lock", "python", "e2e"]);
  });

  it("--no-e2e, --no-python bỏ bước tương ứng; --only lọc theo tên hoặc tiền tố", () => {
    expect(parseArgs(["--no-e2e", "--no-python"])).toEqual({
      e2e: false,
      python: false,
      only: undefined,
      serial: false,
      noFrozen: false,
    });
    expect(buildSteps(parseArgs(["--no-e2e", "--no-python"])).map((s) => s.name)).toEqual([
      "check",
      "typecheck",
      "unit",
      "int",
      "lock",
    ]);
    expect(buildSteps(parseArgs(["--only=e2e"])).map((s) => s.name)).toEqual(["e2e"]);
    expect(buildSteps(parseArgs(["--only=e2e:P-a"]))[0]?.cmd.at(-1)).toBe("--only=P-a");
    expect(buildSteps(parseArgs(["--only=unit"])).map((s) => s.name)).toEqual(["unit"]);
  });
});

describe("TS1 · đợt chạy song song", () => {
  it("nhẹ song song, rồi int (+python), rồi e2e: int và e2e không bao giờ cùng đợt", () => {
    const w = waves(buildSteps({ e2e: true, python: true })).map((s) => s.map((x) => x.name));
    expect(w).toEqual([["check", "typecheck", "unit", "lock"], ["int", "python"], ["e2e"]]);
  });

  it("--serial: mỗi bước một đợt, giữ thứ tự", () => {
    const steps = buildSteps(parseArgs(["--serial", "--no-python"]));
    const w = waves(steps);
    expect(w.every((x) => x.length === 1)).toBe(true);
    expect(w.map((x) => x[0]?.name)).toEqual(["check", "typecheck", "unit", "int", "lock", "e2e"]);
  });
});

describe("GX · test:all trên máy thiếu công cụ / thiếu env", () => {
  it("envLocal: bước unit nạp .env.local tường minh (bun test không tự nạp)", () => {
    const cmd = (envLocal: boolean) =>
      buildSteps({ e2e: false, python: false, envLocal }).find((s) => s.name === "unit")?.cmd;
    expect(cmd(true)).toEqual(["bun", "--env-file=.env.local", "test"]);
    expect(cmd(false)).toEqual(["bun", "test"]);
  });

  it("#230 · thiếu docker/uv: typecheck chạy bản host, python + typecheck agent-runtime là bước BỊ CHẶN có lý do", () => {
    const steps = buildSteps({ e2e: false, python: true, pyBlocked: "thiếu docker" });
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
    expect(buildSteps({ e2e: false, python: true }).some((s) => s.blocked)).toBe(false);
  });
});

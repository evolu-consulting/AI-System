// ADM-NFR-06 · luật chia shard của `test:int:par`.
import { describe, expect, it } from "bun:test";
import {
  defaultWorkers,
  parseEnv,
  parseIntArgs,
  parseJunit,
  partition,
  selectFiles,
  workerEnv,
} from "./test-int-par.rules";

const sum = (s: string[], t: Record<string, number>) => s.reduce((a, f) => a + (t[f] ?? 0), 0);

describe("ADM-NFR-06 · test:int:par", () => {
  it("partition không có số đo: chia vòng tròn theo thứ tự", () => {
    expect(partition(["a", "b", "c", "d", "e"], {}, 2)).toEqual([
      ["a", "c", "e"],
      ["b", "d"],
    ]);
  });

  it("partition tham lam: file dài nhất trước, vào shard nhẹ nhất; mỗi file đúng một shard", () => {
    const t = { a: 10, b: 7, c: 5, d: 4, e: 3, f: 1 };
    const shards = partition(Object.keys(t), t, 2);
    expect(shards.flat().sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    const loads = shards.map((s) => sum(s, t));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(shards[0]?.[0]).toBe("a");
  });

  it("partition: file chưa đo lấy trung bình các file đã đo; n > số file → shard rỗng", () => {
    const shards = partition(["x", "big", "new"], { x: 2, big: 10 }, 2);
    expect(shards).toEqual([["big"], ["new", "x"]]);
    expect(partition(["a"], {}, 3)).toEqual([["a"], [], []]);
  });
});

describe("ADM-NFR-06 · test:int:par · chọn file, cờ", () => {
  it("selectFiles: chuẩn hoá \\, lọc theo tiền tố, tách danh sách tuần tự, bỏ trùng", () => {
    const files = [
      "tests\\acceptance\\K1\\a.int.test.ts",
      "tests/acceptance/P-a/b.int.test.ts",
      "apps/x.int.test.ts",
    ];
    expect(
      selectFiles(
        files,
        ["tests/acceptance/P-a", "./tests/acceptance/K1"],
        ["tests/acceptance/K1/a.int.test.ts"],
      ),
    ).toEqual({
      parallel: ["tests/acceptance/P-a/b.int.test.ts"],
      serial: ["tests/acceptance/K1/a.int.test.ts"],
    });
    expect(selectFiles([...files, files[2] ?? ""], [], []).parallel.length).toBe(3);
  });

  it("parseIntArgs: mặc định min(4, cores/2), --workers=N, ngoài 1..5 → ném; tiền tố còn lại là bộ lọc", () => {
    expect(defaultWorkers(12)).toBe(4);
    expect(defaultWorkers(4)).toBe(2);
    expect(defaultWorkers(1)).toBe(1);
    expect(parseIntArgs(["--workers=3", "tests\\acceptance\\P-a"], 12)).toEqual({
      workers: 3,
      filters: ["tests/acceptance/P-a"],
    });
    expect(() => parseIntArgs(["--workers=0"], 12)).toThrow();
    expect(() => parseIntArgs(["--workers=6"], 12)).toThrow();
    expect(() => parseIntArgs(["--workers=x"], 12)).toThrow();
  });
});

describe("ADM-NFR-06 · test:int:par · JUnit, env worker", () => {
  it("parseJunit: chỉ testsuite cấp file (bỏ describe lồng nhau), giải mã XML", () => {
    const xml = `<?xml version="1.0"?><testsuites time="9">
      <testsuite name="tests/a.int.test.ts" file="tests/a.int.test.ts" time="3.5" tests="2">
        <testsuite name="describe &amp; co" time="3.0"><testcase name="x" time="1"/></testsuite>
      </testsuite>
      <testsuite name="apps\\b.int.test.ts" time="0.25"/>
    </testsuites>`;
    expect(parseJunit(xml)).toEqual({ "tests/a.int.test.ts": 3.5, "apps/b.int.test.ts": 0.25 });
  });

  it("workerEnv: 4 URL DB test sang DB của worker (Admin/Hub tách như khi tuần tự), Redis test DB 10+i", () => {
    const env = {
      TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_test",
      TEST_ADMIN_API_DATABASE_URL: "postgres://admin_api:y@localhost:5432/ai_system_test",
      HUB_TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_h1_test",
      AGENT_RT_TEST_DATABASE_URL: "postgres://agent_runtime:z@localhost:5432/ai_system_h1_test",
      REDIS_URL: "redis://localhost:6379",
    };
    expect(workerEnv(env, 2, (t) => `ai_system_${t}_test`)).toEqual({
      TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_w2_test",
      TEST_ADMIN_API_DATABASE_URL: "postgres://admin_api:y@localhost:5432/ai_system_w2_test",
      HUB_TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_w2_h1_test",
      AGENT_RT_TEST_DATABASE_URL: "postgres://agent_runtime:z@localhost:5432/ai_system_w2_h1_test",
      HUB_TEST_REDIS_URL: "redis://localhost:6379/12",
    });
    expect(Object.keys(workerEnv({}, 0, (t) => t))).toEqual(["HUB_TEST_REDIS_URL"]);
  });

  it("parseEnv: KEY=VALUE, bỏ comment và ngoặc kép bao ngoài", () => {
    expect(parseEnv('# c\nA=1\r\nB="x y"\nlower=no\n')).toEqual({ A: "1", B: "x y" });
  });
});

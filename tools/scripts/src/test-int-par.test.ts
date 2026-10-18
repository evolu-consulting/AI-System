// ADM-NFR-06 · luật hàng đợi, chọn file, env worker của `test:int:par`.
import { describe, expect, it } from "bun:test";
import {
  defaultWorkers,
  lptQueue,
  parseEnv,
  parseIntArgs,
  parseJunit,
  selectFiles,
  takeChunk,
  workerCount,
  workerEnv,
} from "./test-int-par.rules";

describe("ADM-NFR-06 · test:int:par · hàng đợi LPT", () => {
  it("lptQueue: file nặng trước; chưa đo lấy trung bình; hoà theo tên; không có số đo → theo tên", () => {
    expect(lptQueue(["x", "big", "new", "a"], { x: 2, big: 10, a: 2 })).toEqual([
      "big",
      "new",
      "a",
      "x",
    ]);
    expect(lptQueue(["c", "a", "b"], {})).toEqual(["a", "b", "c"]);
  });

  it("takeChunk: ít nhất 1 file (file nặng đi một mình), lô nhỏ dần, hết hàng đợi thì rỗng; mỗi file đúng một lần", () => {
    const t: Record<string, number> = { h: 60 };
    for (let i = 0; i < 40; i++) t[`f${i}`] = 1;
    const q = lptQueue(Object.keys(t), t);
    const chunks: string[][] = [];
    while (q.length) chunks.push(takeChunk(q, t, 4));
    expect(chunks[0]).toEqual(["h"]);
    expect(chunks.flat().sort()).toEqual(Object.keys(t).sort());
    expect((chunks[1] ?? []).length).toBeGreaterThan((chunks.at(-1) ?? []).length);
    expect(takeChunk([], t, 4)).toEqual([]);
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

  it("selectFiles: đường dẫn file cụ thể (kể cả \\, ./) chỉ chọn đúng file đó", () => {
    const all = [
      "tests/acceptance/P-d/d1/uow.int.test.ts",
      "tests/acceptance/P-d/d1/wait.int.test.ts",
      "apps/hub-api/src/modules/processes/adapters/hub-uow.int.test.ts",
    ];
    expect(
      selectFiles(
        all,
        [
          "tests\\acceptance\\P-d\\d1\\uow.int.test.ts",
          "./apps/hub-api/src/modules/processes/adapters/hub-uow.int.test.ts",
        ],
        [],
      ).parallel,
    ).toEqual([
      "apps/hub-api/src/modules/processes/adapters/hub-uow.int.test.ts",
      "tests/acceptance/P-d/d1/uow.int.test.ts",
    ]);
  });

  it("parseIntArgs: mặc định min(4, cores/2), --workers=N, ngoài 1..8 → ném; tiền tố còn lại là bộ lọc", () => {
    expect(defaultWorkers(12)).toBe(4);
    expect(defaultWorkers(4)).toBe(2);
    expect(defaultWorkers(1)).toBe(1);
    expect(parseIntArgs(["--workers=3", "tests\\acceptance\\P-a"], 12)).toEqual({
      workers: 3,
      filters: ["tests/acceptance/P-a"],
    });
    expect(() => parseIntArgs(["--workers=0"], 12)).toThrow();
    expect(() => parseIntArgs(["--workers=9"], 12)).toThrow();
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

  it("workerEnv: 4 URL DB test sang DB của worker (Admin/Hub tách như khi tuần tự), Redis test DB = ô", () => {
    const env = {
      TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_test",
      TEST_ADMIN_API_DATABASE_URL: "postgres://admin_api:y@localhost:5432/ai_system_test",
      HUB_TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_h1_test",
      AGENT_RT_TEST_DATABASE_URL: "postgres://agent_runtime:z@localhost:5432/ai_system_h1_test",
      REDIS_URL: "redis://localhost:6379",
    };
    expect(workerEnv(env, 2, (t) => `ai_system_${t}_test`)).toEqual({
      TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_s2_test",
      TEST_ADMIN_API_DATABASE_URL: "postgres://admin_api:y@localhost:5432/ai_system_s2_test",
      HUB_TEST_DATABASE_URL: "postgres://ai:x@localhost:5432/ai_system_s2_h1_test",
      AGENT_RT_TEST_DATABASE_URL: "postgres://agent_runtime:z@localhost:5432/ai_system_s2_h1_test",
      HUB_TEST_REDIS_URL: "redis://localhost:6379/2",
    });
    expect(Object.keys(workerEnv({}, 0, (t) => t))).toEqual(["HUB_TEST_REDIS_URL"]);
  });

  it("workerCount: 1–2 file ⇒ 1 worker; không quá số file, số ô thuê được", () => {
    expect(workerCount(4, 2, 12)).toBe(1);
    expect(workerCount(4, 1, 12)).toBe(1);
    expect(workerCount(4, 3, 12)).toBe(3);
    expect(workerCount(4, 300, 2)).toBe(2);
    expect(workerCount(4, 300, 12)).toBe(4);
  });

  it("parseEnv: KEY=VALUE, bỏ comment và ngoặc kép bao ngoài", () => {
    expect(parseEnv('# c\nA=1\r\nB="x y"\nlower=no\n')).toEqual({ A: "1", B: "x y" });
  });
});

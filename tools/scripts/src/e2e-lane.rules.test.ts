import { describe, expect, test } from "bun:test";
import {
  allocateLane,
  descendants,
  ENV_FILE_VARS,
  laneEnvFile,
  lanePortEnv,
  lanePortRange,
  laneTag,
  leaseStale,
  MAX_LANE,
  PORT_VARS,
  pickRedisDb,
  pruneRegistry,
  RESERVED_PORTS,
  reapTargets,
  redisEnvFor,
  shiftNumericEnv,
} from "./e2e-lane.rules";

const yes = () => true;

describe("allocateLane", () => {
  test("main = 0; worktree lấy làn thấp nhất còn trống và giữ ổn định", () => {
    const a = allocateLane({}, "F:/wt/a", { isMain: false, exists: yes });
    expect(a.lane).toBe(1);
    const b = allocateLane(a.registry, "F:/wt/b", { isMain: false, exists: yes });
    expect(b.lane).toBe(2);
    expect(allocateLane(b.registry, "F:\\WT\\A\\", { isMain: false, exists: yes }).lane).toBe(1);
    expect(allocateLane(b.registry, "F:/main", { isMain: true, exists: yes }).lane).toBe(0);
  });
  test("đường dẫn không còn ⇒ nhả làn cho worktree mới", () => {
    const reg = { "f:/wt/old": 1, "f:/wt/live": 2 };
    const a = allocateLane(reg, "F:/wt/new", { isMain: false, exists: (p) => p !== "f:/wt/old" });
    expect(a.lane).toBe(1);
    expect(a.registry["f:/wt/old"]).toBeUndefined();
  });
  test("hết làn thì báo lỗi", () => {
    const reg = Object.fromEntries(Array.from({ length: MAX_LANE }, (_, i) => [`p${i}`, i + 1]));
    expect(() => allocateLane(reg, "x", { isMain: false, exists: yes })).toThrow(/hết làn/);
  });
  test("pruneRegistry giữ mục `keep`", () => {
    expect(pruneRegistry({ a: 1, b: 2 }, () => false, "a")).toEqual({ a: 1 });
  });
});

describe("cổng theo làn", () => {
  test("làn 0 giữ mặc định; làn L = mặc định + 3000·L; biến đặt tay thắng", () => {
    expect(lanePortEnv(0)).toEqual({ E2E_PORT_SHIFT: "0" });
    const e = lanePortEnv(2, { PA_E2E_PORT_BASE: "9999" });
    expect(e.PA_E2E_PORT_BASE).toBeUndefined();
    expect(e.FNR_E2E_PORT_BASE).toBe(String(4700 + 6000));
    expect(e.E2E_PORT_SHIFT).toBe("6000");
  });
  test("mọi cổng suy ra: không chồng giữa các làn, tránh 5040, dưới dải động 49152", () => {
    const seen = new Map<number, string>();
    for (let lane = 0; lane <= MAX_LANE; lane++) {
      const [lo] = lanePortRange(lane);
      for (const [k, d] of Object.entries(PORT_VARS)) {
        // mỗi biến chiếm tối đa 8 cổng liền kề (base + 1..6)
        for (let o = 0; o < 8; o++) {
          const p = d + lane * 3000 + o;
          expect(p).toBeGreaterThanOrEqual(lo);
          expect(p).toBeLessThan(49152);
          expect(RESERVED_PORTS).not.toContain(p);
          const prev = seen.get(p);
          if (lane > 0 && prev) expect(prev.split("@")[1]).toBe(String(lane)); // chỉ chồng trong cùng làn
          seen.set(p, `${k}@${lane}`);
        }
      }
    }
  });
  test("shiftNumericEnv chỉ dịch giá trị số", () => {
    expect(shiftNumericEnv({ A: "4041", B: "x" }, 1)).toEqual({ A: "7041", B: "x" });
  });
});

describe("DB / env-file / Redis", () => {
  test("laneTag + laneEnvFile", () => {
    expect(laneTag(0, "pa")).toBe("pa");
    expect(laneTag(3, "pa")).toBe("pa_l3");
    expect(laneEnvFile(1, "e2e/P-a/playwright.pa.config.ts")).toEqual({
      var: "PA_E2E_ENV",
      tag: "pa_e2e_l1",
      file: ".env.test-pa_e2e_l1.local",
    });
    expect(laneEnvFile(1, "e2e/N1/playwright.config.ts")).toBeNull();
    expect(Object.keys(ENV_FILE_VARS).length).toBeGreaterThan(5);
  });
  test("pickRedisDb / leaseStale / redisEnvFor", () => {
    expect(pickRedisDb(new Set())).toBe(7);
    expect(pickRedisDb(new Set([7, 8]))).toBe(9);
    expect(pickRedisDb(new Set([7, 8, 9, 10, 11, 12, 13, 14, 15]))).toBeUndefined();
    expect(leaseStale(1, () => false)).toBe(true);
    expect(leaseStale(1, () => true)).toBe(false);
    expect(redisEnvFor("e2e/P-a/playwright.pa.config.ts", 9, "redis://localhost:6379")).toEqual({
      PA_REDIS_DB: "9",
    });
    expect(
      redisEnvFor("e2e/combine/playwright.config.ts", 9, "redis://localhost:6379").REDIS_TEST_URL,
    ).toBe("redis://localhost:6379/9");
    expect(redisEnvFor("e2e/N1/playwright.config.ts", 9, "redis://x")).toEqual({});
  });
});

describe("reap", () => {
  const root = "F:\\workspace\\evolu-wt\\e2e-isolation";
  const procs = [
    { pid: 10, ppid: 1, name: "bun.exe", cmd: `bun ${root}\\apps\\hub-api\\src\\server.ts` },
    {
      pid: 11,
      ppid: 1,
      name: "node.exe",
      cmd: `node ${root}\\node_modules\\x\\rsbuild.js preview`,
    },
    { pid: 12, ppid: 1, name: "bun.exe", cmd: `bun ${root}2\\apps\\x.ts` }, // thư mục anh em cùng tiền tố
    { pid: 13, ppid: 1, name: "bun.exe", cmd: "bun F:\\workspace\\evolu-platform\\x.ts" },
    { pid: 14, ppid: 1, name: "postgres.exe", cmd: `${root}\\pg` },
    { pid: 15, ppid: 1, name: "bun.exe", cmd: `bun ${root}\\a.ts` }, // không nghe cổng
    { pid: 16, ppid: 1, name: "bun.exe", cmd: `bun ${root}\\b.ts` }, // nghe cổng ngoài dải làn
    { pid: 99, ppid: 1, name: "bun.exe", cmd: `bun ${root}\\self.ts` },
  ];
  const listen = [10, 11, 12, 13, 14, 99]
    .map((pid) => ({ pid, port: 7600 }))
    .concat([{ pid: 16, port: 80 }]);
  test("chỉ bun/node của checkout này, đang nghe cổng trong dải làn, không phải chính mình", () => {
    expect(reapTargets(procs, listen, root, 1, 99)).toEqual([10, 11]);
  });
  test("làn khác ⇒ không khớp cổng", () => {
    expect(reapTargets(procs, listen, root, 0, 99)).toEqual([]);
  });
  test("descendants: lá trước cha", () => {
    const t = [
      { pid: 2, ppid: 1, name: "", cmd: "" },
      { pid: 3, ppid: 2, name: "", cmd: "" },
      { pid: 4, ppid: 3, name: "", cmd: "" },
      { pid: 5, ppid: 9, name: "", cmd: "" },
    ];
    expect(descendants(t, 1)).toEqual([4, 3, 2]);
  });
});

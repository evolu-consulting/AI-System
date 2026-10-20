// TS1 · luật lập việc của `test:e2e:par`: mỗi việc DB/Redis/cổng riêng, ca gốc chia đều, spec ghim cổng 3000 ở ca 0.
import { describe, expect, it } from "bun:test";
import {
  E2E_LOGIN_IP_MAX,
  fileSeconds,
  jobConcurrency,
  jobEnv,
  jobSlug,
  META,
  parseE2eArgs,
  planJobs,
  REDIS_DBS,
  type SpecInfo,
  specPattern,
  splitRoot,
  summarize,
} from "./test-e2e-par.rules";

const spec = (file: string, cost: number, o: Partial<SpecInfo> = {}): SpecInfo => ({
  file,
  cost,
  pin0: false,
  clock: false,
  ...o,
});

describe("TS1 · test:e2e:par · chia ca gốc", () => {
  const specs = [
    spec("e2e/auth.spec.ts", 10, { pin0: true }),
    spec("e2e/a.spec.ts", 30),
    spec("e2e/b.spec.ts", 20),
    spec("e2e/c.spec.ts", 20),
    spec("e2e/d.spec.ts", 5),
    spec("e2e/m4-2fa.spec.ts", 200, { clock: true }),
  ];

  it("file ghim cổng 3000 vào ca 0; file dùng đồng hồ giả riêng một ca; không file nào mất hay trùng", () => {
    const bins = splitRoot(specs, 2);
    expect(bins[0]?.map((s) => s.file)).toContain("e2e/auth.spec.ts");
    expect(bins.at(-1)?.map((s) => s.file)).toEqual(["e2e/m4-2fa.spec.ts"]);
    const all = bins.flat().map((s) => s.file);
    expect(all.sort()).toEqual(specs.map((s) => s.file).sort());
  });

  it("LPT: ca cân bằng (chênh không quá file lớn nhất chưa ghim)", () => {
    const bins = splitRoot(
      specs.filter((s) => !s.clock),
      2,
    );
    const load = bins.map((b) => b.reduce((a, s) => a + s.cost, 0));
    expect(Math.abs((load[0] ?? 0) - (load[1] ?? 0))).toBeLessThanOrEqual(30);
  });

  it("specPattern khớp đúng một file gốc (cả dấu / lẫn \\), không khớp file trùng đuôi", () => {
    const re = new RegExp(specPattern("e2e/users.spec.ts"), "i");
    expect(re.test("F:/x/e2e/users.spec.ts")).toBe(true);
    expect(re.test("F:\\x\\e2e\\users.spec.ts")).toBe(true);
    expect(re.test("F:/x/e2e/m1-users.spec.ts")).toBe(false);
    expect(re.test("F:/x/e2e/users.spec.ts.bak")).toBe(false);
  });
});

describe("TS1 · test:e2e:par · lập việc", () => {
  const configs = [
    "e2e\\P-a\\playwright.pa.config.ts",
    "e2e/chat/playwright.x2a.config.ts",
    "e2e/chat/playwright.config.ts",
    "playwright.config.ts",
  ];
  const specs = [
    spec("e2e/a.spec.ts", 100),
    spec("e2e/b.spec.ts", 90),
    spec("e2e/m4-2fa.spec.ts", 40, { clock: true }),
  ];
  const jobs = planJobs({ configs, specs, rootShards: 2 }, {});

  it("tên việc duy nhất, việc nặng trước", () => {
    const names = jobs.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(["P-a", "chat-x2a", "chat", "root-0", "root-1", "root-clock"]),
    );
    const costs = jobs.map((j) => j.cost);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
  });

  it("mọi việc có DB test khác nhau; việc mock thuần (chat) không có DB", () => {
    const dbs = jobs.flatMap((j) => (j.meta.db ? [j.meta.db] : []));
    expect(new Set(dbs).size).toBe(dbs.length);
    expect(jobs.find((j) => j.name === "chat")?.meta.db).toBeUndefined();
  });

  it("cổng gốc: ca 0 giữ 3000, ca khác ≥ 3410 và khác nhau; chỉ ca đồng hồ có clock", () => {
    const root = jobs.filter((j) => j.config === "playwright.config.ts");
    expect(root.find((j) => j.name === "root-0")?.rootPort).toBe(3000);
    const ports = root.map((j) => j.rootPort);
    expect(new Set(ports).size).toBe(root.length);
    expect(root.filter((j) => j.clock).map((j) => j.name)).toEqual(["root-clock"]);
  });
});

describe("TS1 · test:e2e:par · lọc và số đo", () => {
  const configs = [
    "e2e\\P-a\\playwright.pa.config.ts",
    "e2e/chat/playwright.x2a.config.ts",
    "e2e/chat/playwright.config.ts",
    "playwright.config.ts",
  ];
  const specs = [
    spec("e2e/a.spec.ts", 100),
    spec("e2e/b.spec.ts", 90),
    spec("e2e/m4-2fa.spec.ts", 40, { clock: true }),
  ];
  it("--only lọc theo tên việc hoặc đường dẫn cấu hình", () => {
    expect(planJobs({ configs, specs, rootShards: 2 }, {}, "P-a").map((j) => j.name)).toEqual([
      "P-a",
    ]);
    expect(
      planJobs({ configs, specs, rootShards: 2 }, {}, "e2e/chat")
        .map((j) => j.name)
        .sort(),
    ).toEqual(["chat", "chat-x2a"]);
    expect(planJobs({ configs, specs, rootShards: 2 }, {}, "root").length).toBe(3);
  });

  it("số đo mới đè ước lượng mặc định", () => {
    const j = planJobs({ configs, specs, rootShards: 1 }, { "e2e/P-a/playwright.pa.config.ts": 1 });
    expect(j.find((x) => x.name === "P-a")?.cost).toBe(1);
  });
});

describe("TS1 · test:e2e:par · env mỗi việc", () => {
  const base = {
    TEST_DATABASE_URL: "postgres://ai:pw@localhost:5432/ai_system_test",
    TEST_ADMIN_API_DATABASE_URL: "postgres://admin_api:pw@localhost:5432/ai_system_test",
    REDIS_URL: "redis://localhost:6379",
  };
  const dir = { dist: "dist-e2e/x", clockFile: "/tmp/clock" };
  const job = (cfg: string) => {
    const j = planJobs({ configs: [cfg], specs: [], rootShards: 1 }, {})[0];
    if (!j) throw new Error("no job");
    return j;
  };

  it("DB riêng giữ nguyên user/mật khẩu; Redis DB theo biến của cấu hình", () => {
    const e = jobEnv(job("e2e/P-a/playwright.pa.config.ts"), base, 9, dir);
    expect(e.TEST_DATABASE_URL).toBe("postgres://ai:pw@localhost:5432/ai_system_e2e_pa_test");
    expect(e.TEST_ADMIN_API_DATABASE_URL).toContain(
      "admin_api:pw@localhost:5432/ai_system_e2e_pa_test",
    );
    expect(e.PA_REDIS_DB).toBe("9");
    expect(e.E2E_DIST_DIR).toBe("dist-e2e/x");
    expect(e.E2E_CLOCK_FILE).toBeUndefined();
  });

  it("biến Redis dạng URL; việc không DB/Redis không có biến đó", () => {
    expect(jobEnv(job("e2e/chat/playwright.x2b.config.ts"), base, 11, dir).X2B_REDIS_URL).toBe(
      "redis://localhost:6379/11",
    );
    const e = jobEnv(job("e2e/N1/playwright.config.ts"), base, undefined, dir);
    expect(e.TEST_DATABASE_URL).toBeUndefined();
    expect(Object.keys(e)).toEqual(["E2E_DIST_DIR", "LOGIN_IP_MAX_ATTEMPTS"]);
    expect(e.LOGIN_IP_MAX_ATTEMPTS).toBe(E2E_LOGIN_IP_MAX);
  });

  it("cấu hình lạ nhận DB riêng (không dùng chung ai_system_test)", () => {
    const e = jobEnv(job("e2e/new/playwright.config.ts"), base, undefined, dir);
    expect(e.TEST_DATABASE_URL).toMatch(/ai_system_e2e_x_e2e_new_playwright_test$/);
  });

  it("mỗi cấu hình dùng Redis có biến Redis khai báo; Redis DB e2e không đụng ô int (1–6)", () => {
    for (const [c, m] of Object.entries(META)) if (m.redis) expect(m.db, c).toBeTruthy();
    expect(Math.min(...REDIS_DBS)).toBeGreaterThan(6);
  });
});

describe("TS1 · test:e2e:par · tham số và báo cáo", () => {
  it("jobSlug", () => {
    expect(jobSlug("playwright.config.ts")).toBe("root");
    expect(jobSlug("e2e/P-b2/playwright.pb2.config.ts")).toBe("P-b2");
    expect(jobSlug("e2e/chat/playwright.x2b2.config.ts")).toBe("chat-x2b2");
    expect(jobSlug("e2e/x1/playwright.config.ts")).toBe("x1");
  });

  it("parseE2eArgs, jobConcurrency", () => {
    expect(parseE2eArgs(["--jobs=4", "--only=P-a", "--shards=2"])).toEqual({
      jobs: 4,
      only: "P-a",
      shards: 2,
    });
    expect(parseE2eArgs([]).shards).toBe(3);
    expect(jobConcurrency(undefined, 12)).toBeGreaterThanOrEqual(2);
    expect(() => jobConcurrency(0, 12)).toThrow();
    expect(() => jobConcurrency(99, 12)).toThrow();
  });

  it("summarize + fileSeconds đọc báo cáo JSON của Playwright", () => {
    const rep = {
      stats: { expected: 3, unexpected: 1, flaky: 0 },
      suites: [
        { specs: [{ title: "a", file: "x.spec.ts", tests: [{ results: [{ duration: 1500 }] }] }] },
        {
          suites: [
            {
              specs: [{ title: "b", file: "x.spec.ts", tests: [{ results: [{ duration: 500 }] }] }],
            },
          ],
        },
      ],
    };
    expect(summarize(rep)).toEqual({ pass: 3, fail: 1, flaky: 0 });
    expect(fileSeconds(rep)).toEqual({ "x.spec.ts": 2 });
  });
});

// CR-121 T-1 · chia slot cổng đợt theo thời lượng đo (LPT), mảnh e2e, gom thời lượng, đo file int theo header.
import { describe, expect, it } from "bun:test";
import { baseJobName, parsePiece, pieceName, rootToken, shardToken } from "./e2e-pieces.rules";
import { jobMatches, planJobs, unmatchedOnly } from "./test-e2e-par.rules";
import { HangWatch } from "./test-int-par.watchdog";
import {
  binSeconds,
  collapseDirs,
  e2ePieces,
  emptyTimings,
  planWave,
  WAVE,
  type WaveInput,
} from "./wave-plan.rules";
import { e2eFromReport, e2eKey, intFromJunit, mergeTimings } from "./wave-timings.rules";

const specs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    file: `e2e/s${i}.spec.ts`,
    cost: 10,
    pin0: i === 0,
    clock: i === n - 1,
  }));

function input(over: Partial<WaveInput> = {}): WaveInput {
  const intFiles = Array.from(
    { length: 60 },
    (_, i) => `tests/acceptance/A${i % 6}/f${i}.int.test.ts`,
  );
  const t = emptyTimings();
  intFiles.forEach((f, i) => {
    t.int[f] = 1 + (i % 7) * 5;
  });
  t.e2e["big:a.ts"] = 400;
  t.boot.big = 30;
  return {
    intFiles,
    allIntFiles: intFiles,
    jobs: [
      { job: "big", config: "e2e/big/playwright.config.ts" },
      { job: "small", config: "e2e/small/playwright.config.ts" },
    ],
    rootSpecs: specs(12),
    timings: t,
    slots: 5,
    ...over,
  };
}

describe("wave-plan · chia thùng theo thời lượng", () => {
  it("mọi file int và mọi mảnh e2e có đúng một lần; không thùng nào quá 1.5× thùng nhẹ nhất khi đủ việc", () => {
    const i = input();
    const p = planWave(i);
    const ints = p.bins.flatMap((b) =>
      b.cmds.filter((c) => c.step === "int").flatMap((c) => c.filter.split(" ")),
    );
    // thư mục thu gọn: mở rộng về file để đếm
    const expand = (e: string) =>
      e.endsWith("/") ? i.intFiles.filter((f) => f.startsWith(e)) : [e];
    expect(ints.flatMap(expand).sort()).toEqual([...i.intFiles].sort());
    const tokens = p.bins.flatMap((b) =>
      b.cmds.filter((c) => c.step === "e2e").flatMap((c) => c.filter.split(",")),
    );
    expect(tokens.sort()).toEqual([...p.pieces].sort());
    const min = Math.min(...p.estimates);
    expect(p.wall).toBeLessThanOrEqual(min * 1.5);
  });

  it("việc > trần bị chia mảnh --shard; các mảnh cùng cấu hình không chung thùng", () => {
    const i = input();
    const pieces = e2ePieces(i).filter((x) => x.job === "big");
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    expect(pieces.every((x) => parsePiece(x.token)?.kind === "shard")).toBe(true);
    const p = planWave(i);
    for (const b of p.bins) {
      const e2e = b.cmds.find((c) => c.step === "e2e")?.filter.split(",") ?? [];
      expect(e2e.filter((t) => t.startsWith("big@")).length).toBeLessThanOrEqual(1);
    }
    expect(pieces.every((x) => x.cost <= WAVE.pieceCapS + 1)).toBe(true);
  });

  it("root: spec ghim cổng 3000 ở mảnh 0, spec đồng hồ riêng mảnh clock, đủ file đúng một lần", () => {
    const ps = e2ePieces(input()).filter((x) => x.job.startsWith("root"));
    const parsed = ps.map((x) => parsePiece(x.token));
    const files = parsed.flatMap((p) => (p?.kind === "root" ? p.files : []));
    expect(files.sort()).toEqual(
      specs(12)
        .map((s) => s.file)
        .sort(),
    );
    const p0 = parsed.find((p) => p?.kind === "root" && p.key === "0");
    expect(p0?.kind === "root" && p0.files.includes("e2e/s0.spec.ts")).toBe(true);
    const clock = parsed.find((p) => p?.kind === "root" && p.key === "clock");
    expect(clock?.kind === "root" && clock.files).toEqual(["e2e/s11.spec.ts"]);
  });

  it("quyết định xác định: cùng đầu vào ⇒ cùng kế hoạch; ít slot ⇒ vẫn chạy được (1 thùng)", () => {
    expect(planWave(input())).toEqual(planWave(input()));
    const one = planWave(input({ slots: 1 }));
    expect(one.bins).toHaveLength(1);
    expect(one.wall).toBe(one.estimates[0] as number);
  });

  it("binSeconds: int chia theo tốc độ worker, e2e = làn nặng nhất, mỗi lệnh +overhead", () => {
    expect(binSeconds({ ints: [], pieces: [], intS: 0, lanes: [0, 0] })).toBe(0);
    const v = binSeconds({ ints: ["a"], pieces: [], intS: 16, lanes: [0, 0] });
    expect(v).toBeCloseTo(WAVE.cmdOverheadS + 16 / WAVE.intSpeedup);
  });

  it("collapseDirs: chỉ thu gọn thư mục khi mọi file int dưới nó (kể cả ngoài cổng) thuộc thùng này", () => {
    const all = ["a/x/1.int.test.ts", "a/x/2.int.test.ts", "a/y/3.int.test.ts", "b/4.int.test.ts"];
    expect(collapseDirs(["a/x/1.int.test.ts", "a/x/2.int.test.ts"], all)).toEqual(["a/x/"]);
    expect(collapseDirs(["a/x/1.int.test.ts"], all)).toEqual(["a/x/1.int.test.ts"]);
    expect(
      collapseDirs(["a/x/1.int.test.ts", "a/x/2.int.test.ts", "a/y/3.int.test.ts"], all),
    ).toEqual(["a/"]);
  });
});

describe("mảnh e2e trong test-e2e-par", () => {
  const configs = ["playwright.config.ts", "e2e/studio/playwright.config.ts"];
  const plan = { configs, specs: specs(4), rootShards: 3 };
  it("token mảnh: parse/in ngược, từ chối mảnh gốc > 6 và shard sai", () => {
    expect(parsePiece(rootToken(2, ["e2e/a.spec.ts", "e2e/b.spec.ts"]))).toEqual({
      kind: "root",
      key: "2",
      files: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
    });
    expect(parsePiece("root@9=e2e/a.spec.ts")).toBeNull();
    expect(parsePiece(shardToken("studio", 2, 3))).toEqual({
      kind: "shard",
      job: "studio",
      i: 2,
      n: 3,
    });
    expect(parsePiece("studio@4/3")).toBeNull();
    expect(pieceName({ kind: "shard", job: "studio", i: 1, n: 2 })).toBe("studio.1of2");
    expect(baseJobName("studio.1of2")).toBe("studio");
    expect(baseJobName("root-clock")).toBe("root");
  });

  it("--only gồm mảnh ⇒ chỉ chạy đúng các mảnh (file đúng, cổng/DB riêng, shard của Playwright)", () => {
    const jobs = planJobs(
      plan,
      {},
      "root@0=e2e/s0.spec.ts+e2e/s1.spec.ts,root@3=e2e/s2.spec.ts,studio@2/3",
    );
    expect(jobs.map((j) => j.name).sort()).toEqual(["root-0", "root-3", "studio.2of3"]);
    const r0 = jobs.find((j) => j.name === "root-0");
    expect(r0?.rootPort).toBe(3000);
    expect(r0?.files).toHaveLength(2);
    expect(jobs.find((j) => j.name === "root-3")?.meta.db).toBe("root3");
    expect(jobs.find((j) => j.name === "studio.2of3")?.files).toEqual(["--shard=2/3"]);
  });

  it("unmatchedOnly: mảnh của việc có thật không bị báo lạ; việc lạ vẫn báo", () => {
    const all = planJobs(plan, {});
    expect(unmatchedOnly(all, "root@0=e2e/s0.spec.ts,studio@1/2")).toEqual([]);
    expect(unmatchedOnly(all, "zzz@1/2")).toEqual(["zzz@1/2"]);
    expect(all.some((j) => jobMatches(j, "root"))).toBe(true);
  });
});

describe("gom thời lượng", () => {
  it("intFromJunit: file = tổng ca + phần chung chia đều (JUnit cấp file time=0)", () => {
    const xml = `<testsuites time="10"><testsuite name="a" time="0">
<testcase name="x" time="1.5" file="a.int.test.ts" /><testcase name="y" time="0.5" file="a.int.test.ts" />
<testcase name="z" time="2" file="b.int.test.ts" /></testsuite></testsuites>`;
    expect(intFromJunit(xml)).toEqual({ "a.int.test.ts": 5, "b.int.test.ts": 5 });
  });

  it("e2eFromReport: ca đỏ tính mức trần (không phải 30 s chờ hết giờ), boot = tổng − ca", () => {
    const rep = {
      stats: { duration: 100_000 },
      suites: [
        {
          specs: [
            { file: "a.spec.ts", tests: [{ results: [{ duration: 10_000, status: "passed" }] }] },
            { file: "b.spec.ts", tests: [{ results: [{ duration: 30_000, status: "timedOut" }] }] },
          ],
        },
      ],
    };
    const r = e2eFromReport(rep);
    expect(r.files).toEqual({ "a.spec.ts": 10, "b.spec.ts": 8 });
    expect(r.boot).toBe(60);
  });

  it("mergeTimings: khoá root = e2e/<file>, việc khác = <việc>:<file>; giữ khoá cũ; mảnh cùng việc chung boot", () => {
    const old = { int: { x: 1 }, e2e: { "studio:old.ts": 5 }, boot: {} };
    const t = mergeTimings(old, {
      int: { y: 2 },
      jobs: {
        "root-1": { files: { "a.spec.ts": 3 }, boot: 20 },
        "studio.1of2": { files: { "n.ts": 4 }, boot: 12 },
        "studio.2of2": { files: { "m.ts": 6 }, boot: 15 },
      },
    });
    expect(t.int).toEqual({ x: 1, y: 2 });
    expect(t.e2e).toEqual({
      "studio:old.ts": 5,
      "e2e/a.spec.ts": 3,
      "studio:n.ts": 4,
      "studio:m.ts": 6,
    });
    expect(t.boot).toEqual({ root: 20, studio: 15 });
    expect(e2eKey("root-clock", "m4.spec.ts")).toBe("e2e/m4.spec.ts");
  });
});

describe("HangWatch · thời lượng mỗi file (header → header)", () => {
  it("ghi mili giây mỗi file theo đồng hồ giả, file cuối đóng ở finish", () => {
    const w = new HangWatch(["a.int.test.ts", "b.int.test.ts"], { idleS: 0, fileS: 0 }, 0);
    w.feed("a.int.test.ts:\n(pass) t1 [1ms]\n", 1000);
    w.feed("b.int.test.ts:\n(pass) t2 [1ms]\n", 4000);
    const m = w.finish(9000);
    expect(m.get("a.int.test.ts")).toBe(3000);
    expect(m.get("b.int.test.ts")).toBe(5000);
  });
});

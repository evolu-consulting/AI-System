// CR-121 T-1 Â· chia slot cá»•ng Ä‘á»£t theo thá»i lÆ°á»£ng Ä‘o (LPT), máº£nh e2e, gom thá»i lÆ°á»£ng, Ä‘o file int theo header.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import {
  baseJobName,
  parsePiece,
  pieceName,
  ROOT_CLOCK_PORT,
  rootToken,
  shardToken,
} from "./e2e-pieces.rules";
import { jobMatches, planJobs, unmatchedOnly } from "./test-e2e-par.rules";
import { HangWatch } from "./test-int-par.watchdog";
import {
  binSeconds,
  collapseDirs,
  e2ePieces,
  emptyTimings,
  planWave,
  specFileCount,
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
  for (let k = 0; k < 8; k++) t.e2e[`big:f${k}.ts`] = 50;
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

describe("wave-plan Â· chia thÃ¹ng theo thá»i lÆ°á»£ng", () => {
  it("má»i file int vÃ  má»i máº£nh e2e cÃ³ Ä‘Ãºng má»™t láº§n; khÃ´ng thÃ¹ng nÃ o quÃ¡ 1.5Ã— thÃ¹ng nháº¹ nháº¥t khi Ä‘á»§ viá»‡c", () => {
    const i = input();
    const p = planWave(i);
    const ints = p.bins.flatMap((b) =>
      b.cmds.filter((c) => c.step === "int").flatMap((c) => c.filter.split(" ")),
    );
    // thÆ° má»¥c thu gá»n: má»Ÿ rá»™ng vá» file Ä‘á»ƒ Ä‘áº¿m
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

  it("viá»‡c > tráº§n bá»‹ chia máº£nh --shard; cÃ¡c máº£nh cÃ¹ng cáº¥u hÃ¬nh khÃ´ng chung thÃ¹ng", () => {
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

  it("số mảnh --shard không vượt số thùng và không vượt số file spec (không có mảnh rỗng / hai mảnh cùng cấu hình một slot)", () => {
    const i = input();
    // 8 file × 50 s: muốn ≥ 3 mảnh; ít thùng hơn ⇒ ít mảnh hơn
    for (const slots of [2, 3, 7]) {
      const n = e2ePieces({ ...i, slots }).filter((x) => x.job === "big").length;
      expect(n).toBeLessThanOrEqual(slots);
      const bins = planWave({ ...i, slots }).bins;
      for (const b of bins) {
        const e2e = b.cmds.find((c) => c.step === "e2e")?.filter.split(",") ?? [];
        expect(e2e.filter((tk) => tk.startsWith("big")).length).toBeLessThanOrEqual(1);
      }
    }
    // chỉ 2 file spec đã đo ⇒ tối đa 2 mảnh dù tổng giây rất lớn
    const t = { ...i.timings, e2e: { ...i.timings.e2e } };
    for (const k of Object.keys(t.e2e)) if (k.startsWith("big:")) delete t.e2e[k];
    t.e2e["big:a.ts"] = 900;
    t.e2e["big:b.ts"] = 900;
    const mảnh = e2ePieces({ ...i, timings: t, slots: 9 }).filter((x) => x.job === "big");
    expect(mảnh.length).toBe(2);
    expect(specFileCount(t, "big")).toBe(2);
  });

  it("kế hoạch giống lượt hỏng: nhiều mảnh hơn thùng ⇒ không thùng nào có hai mảnh của một cấu hình", () => {
    const base = input({ slots: 7 });
    const t = {
      ...base.timings,
      e2e: { ...base.timings.e2e },
      boot: { ...base.timings.boot, big: 20 },
    };
    for (let k = 0; k < 46; k++) t.e2e[`big:g${k}.ts`] = 20; // ≈ 920 s ⇒ muốn ~8+ mảnh > 7 thùng
    const p = planWave({ ...base, timings: t });
    const all = p.bins.flatMap((b) => b.cmds.filter((c) => c.step === "e2e"));
    for (const c of all) {
      const mine = c.filter.split(",").filter((tk) => tk.startsWith("big@"));
      expect(mine.length).toBeLessThanOrEqual(1);
    }
    const shards = p.pieces.filter((tk) => tk.startsWith("big@"));
    expect(shards.length).toBeLessThanOrEqual(7);
    expect(new Set(shards.map((tk) => tk.split("/")[1])).size).toBe(1); // cùng n
  });
  it("root: spec ghim cá»•ng 3000 á»Ÿ máº£nh 0, spec Ä‘á»“ng há»“ riÃªng máº£nh clock, Ä‘á»§ file Ä‘Ãºng má»™t láº§n", () => {
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

  it("quyáº¿t Ä‘á»‹nh xÃ¡c Ä‘á»‹nh: cÃ¹ng Ä‘áº§u vÃ o â‡’ cÃ¹ng káº¿ hoáº¡ch; Ã­t slot â‡’ váº«n cháº¡y Ä‘Æ°á»£c (1 thÃ¹ng)", () => {
    expect(planWave(input())).toEqual(planWave(input()));
    const one = planWave(input({ slots: 1 }));
    expect(one.bins).toHaveLength(1);
    expect(one.wall).toBe(one.estimates[0] as number);
  });

  it("binSeconds: int chia theo tá»‘c Ä‘á»™ worker, e2e = lÃ n náº·ng nháº¥t, má»—i lá»‡nh +overhead", () => {
    expect(binSeconds({ ints: [], pieces: [], intS: 0, lanes: [0, 0] })).toBe(0);
    const v = binSeconds({ ints: ["a"], pieces: [], intS: 16, lanes: [0, 0] });
    expect(v).toBeCloseTo(WAVE.cmdOverheadS + 16 / WAVE.intSpeedup);
  });

  it("collapseDirs: chá»‰ thu gá»n thÆ° má»¥c khi má»i file int dÆ°á»›i nÃ³ (ká»ƒ cáº£ ngoÃ i cá»•ng) thuá»™c thÃ¹ng nÃ y", () => {
    const all = ["a/x/1.int.test.ts", "a/x/2.int.test.ts", "a/y/3.int.test.ts", "b/4.int.test.ts"];
    expect(collapseDirs(["a/x/1.int.test.ts", "a/x/2.int.test.ts"], all)).toEqual(["a/x/"]);
    expect(collapseDirs(["a/x/1.int.test.ts"], all)).toEqual(["a/x/1.int.test.ts"]);
    expect(
      collapseDirs(["a/x/1.int.test.ts", "a/x/2.int.test.ts", "a/y/3.int.test.ts"], all),
    ).toEqual(["a/"]);
  });
});

describe("máº£nh e2e trong test-e2e-par", () => {
  const configs = ["playwright.config.ts", "e2e/studio/playwright.config.ts"];
  const plan = { configs, specs: specs(4), rootShards: 3 };
  it("token máº£nh: parse/in ngÆ°á»£c, tá»« chá»‘i máº£nh gá»‘c > 6 vÃ  shard sai", () => {
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

  it("--only gá»“m máº£nh â‡’ chá»‰ cháº¡y Ä‘Ãºng cÃ¡c máº£nh (file Ä‘Ãºng, cá»•ng/DB riÃªng, shard cá»§a Playwright)", () => {
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
    expect(jobs.find((j) => j.name === "studio.2of3")?.files).toEqual([
      "--shard=2/3",
      "--pass-with-no-tests",
    ]);
  });

  it("unmatchedOnly: máº£nh cá»§a viá»‡c cÃ³ tháº­t khÃ´ng bá»‹ bÃ¡o láº¡; viá»‡c láº¡ váº«n bÃ¡o", () => {
    const all = planJobs(plan, {});
    expect(unmatchedOnly(all, "root@0=e2e/s0.spec.ts,studio@1/2")).toEqual([]);
    expect(unmatchedOnly(all, "zzz@1/2")).toEqual(["zzz@1/2"]);
    expect(all.some((j) => jobMatches(j, "root"))).toBe(true);
  });
});

describe("gom thá»i lÆ°á»£ng", () => {
  it("intFromJunit: file = tá»•ng ca + pháº§n chung chia Ä‘á»u (JUnit cáº¥p file time=0)", () => {
    const xml = `<testsuites time="10"><testsuite name="a" time="0">
<testcase name="x" time="1.5" file="a.int.test.ts" /><testcase name="y" time="0.5" file="a.int.test.ts" />
<testcase name="z" time="2" file="b.int.test.ts" /></testsuite></testsuites>`;
    expect(intFromJunit(xml)).toEqual({ "a.int.test.ts": 5, "b.int.test.ts": 5 });
  });

  it("e2eFromReport: ca Ä‘á» tÃ­nh má»©c tráº§n (khÃ´ng pháº£i 30 s chá» háº¿t giá»), boot = tá»•ng âˆ’ ca", () => {
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

  it("mergeTimings: khoÃ¡ root = e2e/<file>, viá»‡c khÃ¡c = <viá»‡c>:<file>; giá»¯ khoÃ¡ cÅ©; máº£nh cÃ¹ng viá»‡c chung boot", () => {
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
    expect(t.boot).toEqual({ root: 20, studio: 14 });
    expect(e2eKey("root-clock", "m4.spec.ts")).toBe("e2e/m4.spec.ts");
  });
});

describe("HangWatch Â· thá»i lÆ°á»£ng má»—i file (header â†’ header)", () => {
  it("ghi mili giÃ¢y má»—i file theo Ä‘á»“ng há»“ giáº£, file cuá»‘i Ä‘Ã³ng á»Ÿ finish", () => {
    const w = new HangWatch(["a.int.test.ts", "b.int.test.ts"], { idleS: 0, fileS: 0 }, 0);
    w.feed("a.int.test.ts:\n(pass) t1 [1ms]\n", 1000);
    w.feed("b.int.test.ts:\n(pass) t2 [1ms]\n", 4000);
    const m = w.finish(9000);
    expect(m.get("a.int.test.ts")).toBe(3000);
    expect(m.get("b.int.test.ts")).toBe(5000);
  });
});

describe("cổng e2e chạy cùng một slot không đè nhau", () => {
  // Lượt wave 4: root-2 (3420) đè pm-checklist (3420), root-4 (3440) đè journey (3440) — mọi việc trong một slot chung mạng container.
  it("mảnh gốc dùng dải 3600–3699 (web = 3600 + 10k, API = web + 1, clock 3690) và không cấu hình e2e nào khác dùng dải đó", async () => {
    const ports = [1, 2, 3, 4, 5, 6].map((k) => {
      const j = planJobs(
        { configs: ["playwright.config.ts"], specs: specs(3), rootShards: 3 },
        {},
        `root@${k}=e2e/s0.spec.ts`,
      )[0];
      return j?.rootPort ?? 0;
    });
    const range = [...ports, ROOT_CLOCK_PORT].flatMap((p) => [p, p + 1]);
    expect(range.every((p) => p >= 3600 && p <= 3699)).toBe(true);
    expect(new Set(range).size).toBe(range.length);
    const root = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const files = [
      ...new Glob("e2e/**/playwright*.config.ts").scanSync({ cwd: root }),
      ...new Glob("e2e/**/_*.ts").scanSync({ cwd: root }),
    ];
    expect(files.length).toBeGreaterThan(5);
    const clash = files.filter((f) =>
      [...readFileSync(join(root, f), "utf8").matchAll(/\b(3[6]\d\d)\b/g)].some((m) =>
        range.includes(Number(m[1])),
      ),
    );
    expect(clash).toEqual([]);
  });
});

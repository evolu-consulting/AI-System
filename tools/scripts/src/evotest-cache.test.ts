// tool-evotest-cache · unit: khoá bản dựng, định danh mã nguồn, khoá thư mục có nhịp tim, "dựng một lần", kế hoạch xoá cache.
import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchBuildScripts } from "./evotest-cache";
import { ensureCached, hashTree, withDirLock } from "./evotest-cache.lib";
import {
  type BuildStat,
  buildEnvSubset,
  buildKey,
  CACHED_BUILD,
  hashExcluded,
  PLAIN_BUILD,
  patchBuildScript,
  pkgDirOf,
  planEviction,
  srcId,
  summarizeStats,
} from "./evotest-cache.rules";

const tmp = () => mkdtempSync(join(tmpdir(), "evo-cache-"));
const base = {
  pkg: "@ai/chat-web",
  srcId: "c-abc1234",
  lockHash: "L1",
  toolchain: "bun-1.3.14",
  env: {},
};

describe("buildEnvSubset / buildKey", () => {
  it("chỉ PUBLIC_* và NODE_ENV; cổng/URL proxy không vào khoá", () => {
    expect(
      buildEnvSubset({
        PUBLIC_HUB_URL: "x",
        NODE_ENV: "production",
        HUB_URL: "y",
        E2E_DIST_DIR: "d",
        PATH: "p",
      }),
    ).toEqual({
      NODE_ENV: "production",
      PUBLIC_HUB_URL: "x",
    });
  });
  it("cùng đầu vào ⇒ cùng khoá; HUB_URL/E2E_DIST_DIR khác không đổi khoá", () => {
    const k = buildKey(base);
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    expect(buildKey({ ...base, env: { HUB_URL: "http://a", E2E_DIST_DIR: "dist-e2e/x" } })).toBe(k);
  });
  it("đổi gói / commit / bun.lock / bun / PUBLIC_* ⇒ khoá khác", () => {
    const k = buildKey(base);
    const others = [
      { pkg: "@ai/admin-web" },
      { srcId: "c-def5678" },
      { lockHash: "L2" },
      { toolchain: "bun-1.3.15" },
      { env: { PUBLIC_HUB_URL: "http://localhost:4502" } },
    ].map((o) => buildKey({ ...base, ...o }));
    expect(new Set([k, ...others]).size).toBe(6);
  });
  it("thứ tự khoá env không ảnh hưởng", () => {
    expect(buildKey({ ...base, env: { PUBLIC_A: "1", PUBLIC_B: "2" } })).toBe(
      buildKey({ ...base, env: { PUBLIC_B: "2", PUBLIC_A: "1" } }),
    );
  });
});

describe("srcId", () => {
  it("VERSION là commit sạch ⇒ c-<commit>, không băm nội dung", () => {
    let called = 0;
    expect(
      srcId("abc1234\n", () =>
        (() => {
          called++;
          return "x";
        })(),
      ),
    ).toBe("c-abc1234");
    expect(called).toBe(0);
  });
  it("+dirty hoặc thiếu VERSION ⇒ h-<băm nội dung>", () => {
    expect(srcId("abc1234+dirty", () => "f".repeat(64))).toBe(`h-${"f".repeat(20)}`);
    expect(srcId(undefined, () => "a".repeat(64))).toBe(`h-${"a".repeat(20)}`);
  });
});

describe("hashTree / hashExcluded", () => {
  it("đổi nội dung ⇒ băm đổi; file sinh ra (routeTree.gen.ts, dist, node_modules, test) không tính", () => {
    const r = tmp();
    mkdirSync(join(r, "apps/x/src"), { recursive: true });
    writeFileSync(join(r, "apps/x/src/a.ts"), "1");
    const h1 = hashTree(r, ["apps"]);
    writeFileSync(join(r, "apps/x/src/routeTree.gen.ts"), "gen");
    mkdirSync(join(r, "apps/x/dist-e2e/j"), { recursive: true });
    writeFileSync(join(r, "apps/x/dist-e2e/j/i.js"), "out");
    writeFileSync(join(r, "apps/x/src/a.test.ts"), "t");
    expect(hashTree(r, ["apps"])).toBe(h1);
    writeFileSync(join(r, "apps/x/src/a.ts"), "2");
    expect(hashTree(r, ["apps"])).not.toBe(h1);
    expect(hashExcluded("packages/y/node_modules/z/i.js")).toBe(true);
    expect(hashExcluded("apps/x/src/a.ts")).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });
});

describe("pkgDirOf / summarizeStats", () => {
  it("tìm thư mục theo tên gói", () => {
    expect(pkgDirOf([{ dir: "apps/chat-web", name: "@ai/chat-web" }], "@ai/chat-web")).toBe(
      "apps/chat-web",
    );
    expect(pkgDirOf([], "@ai/x")).toBeUndefined();
  });
  it("tóm tắt đếm hit/miss/chờ", () => {
    const s = (result: BuildStat["result"], ms: number): BuildStat => ({
      pkg: "p",
      key: "k",
      result,
      ms,
      copyMs: 100,
    });
    const out = summarizeStats([
      s("miss", 60_000),
      s("hit", 500),
      s("hit", 400),
      s("wait", 20_000),
    ]);
    expect(out).toContain("2 hit, 1 miss, 1 chờ");
    expect(out).toContain("dựng 60.0 s");
  });
});

describe("script build: no-op ngoài evotest", () => {
  const ROOT = join(import.meta.dir, "../../..");
  const WEB = ["admin-web", "chat-web", "community-web", "workspace-web", "studio-web"];
  it("repo giữ nguyên `rsbuild build` ở 5 app web (prod Docker/local không đi qua cache)", () => {
    for (const a of WEB) {
      const j = JSON.parse(readFileSync(join(ROOT, "apps", a, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(j.scripts.build).toBe(PLAIN_BUILD);
    }
  });
  it("patchBuildScript chỉ đổi đúng `rsbuild build`", () => {
    expect(patchBuildScript(PLAIN_BUILD)).toBe(CACHED_BUILD);
    expect(patchBuildScript("tsc -b")).toBe("tsc -b");
    expect(patchBuildScript(undefined)).toBeUndefined();
  });
  it("patchBuildScripts (chỉ chạy trong bản sao tạm của evotest): đổi app dùng rsbuild, giữ script khác, chạy lại không đổi", () => {
    const r = tmp();
    for (const [n, build] of [
      ["a-web", PLAIN_BUILD],
      ["b-api", "tsc -b"],
    ] as const) {
      mkdirSync(join(r, "apps", n), { recursive: true });
      writeFileSync(
        join(r, "apps", n, "package.json"),
        JSON.stringify({ name: n, scripts: { build, test: "bun test" } }),
      );
    }
    expect(patchBuildScripts(r)).toEqual(["apps/a-web/package.json"]);
    const a = JSON.parse(readFileSync(join(r, "apps/a-web/package.json"), "utf8"));
    const b = JSON.parse(readFileSync(join(r, "apps/b-api/package.json"), "utf8"));
    expect(a.scripts).toEqual({ build: CACHED_BUILD, test: "bun test" });
    expect(b.scripts.build).toBe("tsc -b");
    expect(patchBuildScripts(r)).toEqual([]);
  });
});

describe("withDirLock", () => {
  it("loại trừ lẫn nhau: hai lượt không chồng lên nhau", async () => {
    const r = tmp();
    const lock = join(r, "l");
    const log: string[] = [];
    const run = (n: string) =>
      withDirLock(
        lock,
        async () => {
          log.push(`in ${n}`);
          await Bun.sleep(60);
          log.push(`out ${n}`);
        },
        { pollMs: 10 },
      );
    await Promise.all([run("a"), run("b"), run("c")]);
    for (let i = 0; i < log.length; i += 2) expect(log[i]?.replace("in", "out")).toBe(log[i + 1]);
    expect(existsSync(lock)).toBe(false); // nhả khoá
  });
  it("khoá mồ côi (nhịp tim cũ) bị gỡ; khoá còn nhịp tim thì chờ tới quá hạn", async () => {
    const r = tmp();
    const dead = join(r, "dead");
    mkdirSync(dead);
    writeFileSync(join(dead, "hb"), "0");
    utimesSync(join(dead, "hb"), new Date(0), new Date(0));
    expect(await withDirLock(dead, async () => "ok", { staleMs: 1000, pollMs: 10 })).toBe("ok");
    const live = join(r, "live");
    mkdirSync(live);
    writeFileSync(join(live, "hb"), String(Date.now()));
    await expect(
      withDirLock(live, async () => 1, { staleMs: 60_000, pollMs: 10, timeoutMs: 100 }),
    ).rejects.toThrow("quá hạn");
    expect(existsSync(live)).toBe(true); // không gỡ khoá của người khác
  });
  it("fn ném lỗi vẫn nhả khoá", async () => {
    const r = tmp();
    await expect(
      withDirLock(join(r, "l"), async () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    expect(existsSync(join(r, "l"))).toBe(false);
  });
});

describe("ensureCached", () => {
  it("8 lượt đồng thời cùng khoá ⇒ produce đúng 1 lần; mọi lượt thấy cùng thư mục thành phẩm", async () => {
    const r = tmp();
    let produced = 0;
    const one = () =>
      ensureCached({
        root: r,
        key: "k1",
        ref: "c-1",
        lock: { pollMs: 5 },
        produce: async (t) => {
          produced++;
          await Bun.sleep(80);
          writeFileSync(join(t, "f.txt"), "data");
        },
      });
    const res = await Promise.all(Array.from({ length: 8 }, one));
    expect(produced).toBe(1);
    expect(res.filter((x) => x.built).length).toBe(1);
    expect(res.filter((x) => x.waited && !x.built).length).toBeGreaterThan(0);
    for (const x of res) expect(readFileSync(join(x.dir, "f.txt"), "utf8")).toBe("data");
    expect(readFileSync(join(r, "k1", ".ref"), "utf8")).toBe("c-1");
    // lần sau: hit, không produce
    const again = await one();
    expect(again.built).toBe(false);
    expect(produced).toBe(1);
  });
  it("produce lỗi ⇒ không để lại thư mục dở; lượt sau dựng lại được", async () => {
    const r = tmp();
    await expect(
      ensureCached({
        root: r,
        key: "k2",
        ref: "c",
        produce: async () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(join(r, "k2"))).toBe(false);
    const ok = await ensureCached({
      root: r,
      key: "k2",
      ref: "c",
      produce: async (t) => void writeFileSync(join(t, "a"), "1"),
    });
    expect(ok.built).toBe(true);
  });
});

describe("planEviction", () => {
  const MB = 1e6;
  const e = (name: string, ref: string, ageMin: number, mb = 10) => ({
    name,
    ref,
    mtimeMs: 1_000_000_000 - ageMin * 60_000,
    bytes: mb * MB,
  });
  const o = { keep: 2, maxBytes: 1e12, now: 1_000_000_000, protectMs: 10 * 60_000 };
  it("giữ N ref dùng gần nhất, xoá các mục của ref cũ hơn", () => {
    const es = [
      e("a1", "r1", 300),
      e("a2", "r1", 290),
      e("b1", "r2", 200),
      e("c1", "r3", 100),
      e("c2", "r3", 120),
    ];
    expect(planEviction(es, o)).toEqual(["a1", "a2"]);
  });
  it("tuổi ref = mục MỚI nhất của ref (ref có một mục mới thì cả ref được giữ)", () => {
    const es = [e("a1", "r1", 500), e("a2", "r1", 5), e("b1", "r2", 100), e("c1", "r3", 200)];
    expect(planEviction(es, { ...o, now: 1_000_000_000 })).toEqual(["c1"]);
  });
  it("vượt trần dung lượng ⇒ bỏ tiếp ref cũ nhất nhưng luôn giữ ref mới nhất", () => {
    const es = [e("a", "r1", 300, 400), e("b", "r2", 200, 400), e("c", "r3", 100, 400)];
    expect(planEviction(es, { ...o, keep: 5, maxBytes: 900 * MB })).toEqual(["a"]);
    expect(planEviction(es, { ...o, keep: 5, maxBytes: 1 })).toEqual(["a", "b"]);
  });
  it("mục sửa trong protectMs không bao giờ bị xoá", () => {
    const es = [e("new-old-ref", "r1", 3), e("x", "r2", 100), e("y", "r3", 200), e("z", "r4", 300)];
    expect(planEviction(es, { ...o, keep: 1 })).toEqual(["x", "y", "z"]);
    const only = [e("p", "r1", 1), e("q", "r2", 2)];
    expect(planEviction(only, { ...o, keep: 1 })).toEqual([]); // q thuộc ref bị bỏ nhưng mới sửa ⇒ giữ
  });
});

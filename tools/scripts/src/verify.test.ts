// verify:* · luật thuần (VERSION, tổ tiên, migration mới/mất, env mới, migration đã áp, health, log lỗi, tóm tắt).
import { describe, expect, it } from "bun:test";
import {
  clip,
  compareMigrations,
  countMigrations,
  envVarNames,
  errorLogSummary,
  healthOk,
  journalCount,
  legSummary,
  listMigrationsByStatus,
  newEnvVars,
  newRedLines,
  parseApplied,
  parseVersionLine,
  predeployVerdict,
  redact,
  render,
  sliceVerdict,
  tableToDir,
  waveFilters,
  waveVerdict,
} from "./verify.rules";

const NONE = { admin: [], hub: [], packs: {} };

describe("verify · predeploy", () => {
  it("parseVersionLine: `<commit> (<ref>)`, commit trần, rác", () => {
    expect(parseVersionLine("45f218e7 (platform/gd0_dlc)")).toEqual({
      commit: "45f218e7",
      ref: "platform/gd0_dlc",
    });
    expect(parseVersionLine("abcdef1")).toEqual({ commit: "abcdef1", ref: "" });
    expect(parseVersionLine("")).toBeNull();
    expect(parseVersionLine("không phải commit")).toBeNull();
  });

  it("listMigrationsByStatus: admin/hub/pack, chỉ .sql, đúng trạng thái; bỏ -dev và meta", () => {
    const ns = [
      "A\tpackages/db/migrations/0070_a.sql",
      "A\tpackages/db/migrations-hub/0071_b.sql",
      "A\tpackages/db/migrations-pack-community/0003_c.sql",
      "A\tpackages/db/migrations-pack-dlc/0001_d.sql",
      "A\tpackages/db/migrations/meta/0070_snapshot.json",
      "A\tpackages/db/migrations-dev/0001_x.sql",
      "D\tpackages/db/migrations/0001_gone.sql",
      "M\tpackages/db/migrations/0002_m.sql",
    ].join("\n");
    const a = listMigrationsByStatus(ns, "A");
    expect(a).toEqual({
      admin: ["0070_a.sql"],
      hub: ["0071_b.sql"],
      packs: { community: ["0003_c.sql"], dlc: ["0001_d.sql"] },
    });
    expect(countMigrations(a)).toBe(4);
    expect(listMigrationsByStatus(ns, "D").admin).toEqual(["0001_gone.sql"]);
  });

  it("newEnvVars: biến có ở ref mà prod chưa có; bỏ chú thích", () => {
    const prev = "# c\nA=\nB=\n";
    const ref = "# c\nA=\nB=\nC_NEW=\n# D=x\nD_NEW=1\n";
    expect([...envVarNames(ref)]).toEqual(["A", "B", "C_NEW", "D_NEW"]);
    expect(newEnvVars(prev, ref)).toEqual(["C_NEW", "D_NEW"]);
  });

  it("predeployVerdict: tổ tiên + migration mới + env ⇒ OK", () => {
    const v = predeployVerdict("a1b2 (platform/gd0)", {
      prod: { commit: "45f218e7", ref: "gd0" },
      ancestor: true,
      added: { admin: ["0070_a.sql"], hub: [], packs: { dlc: ["0001.sql"] } },
      lost: NONE,
      envNew: ["X_NEW"],
    });
    expect(v.ok).toBe(true);
    expect(v.lines.join("\n")).toContain("tổ tiên OK");
    expect(v.lines.join("\n")).toContain("admin 1, hub 0, pack-dlc 1");
    expect(v.lines.join("\n")).toContain("X_NEW");
  });

  it("predeployVerdict: không phải tổ tiên / không có trong repo / mất migration ⇒ DỪNG", () => {
    const base = { prod: { commit: "c0ffee1", ref: "dlc" }, added: NONE, envNew: [] as string[] };
    const no = predeployVerdict("r", {
      ...base,
      ancestor: false,
      lost: { admin: ["0064_agent_hooks.sql"], hub: [], packs: {} },
    });
    expect(no.ok).toBe(false);
    expect(no.lines.join("\n")).toContain("0064_agent_hooks.sql");
    expect(predeployVerdict("r", { ...base, ancestor: null, lost: NONE }).ok).toBe(false);
    expect(
      predeployVerdict("r", {
        ...base,
        ancestor: true,
        lost: { admin: ["x.sql"], hub: [], packs: {} },
      }).ok,
    ).toBe(false);
    expect(predeployVerdict("r", { ...base, prod: null, ancestor: null, lost: NONE }).ok).toBe(
      true,
    );
  });
});

describe("verify · prod", () => {
  it("tableToDir + parseApplied (bỏ bảng _dev) + compareMigrations", () => {
    expect(tableToDir("drizzle.__drizzle_migrations")).toBe("migrations");
    expect(tableToDir("drizzle.__drizzle_migrations_hub")).toBe("migrations-hub");
    expect(tableToDir("drizzle.__drizzle_migrations_pack_community")).toBe(
      "migrations-pack-community",
    );
    expect(tableToDir("x.khac")).toBeNull();
    const out =
      "VERSION:abc\nMIG:drizzle.__drizzle_migrations:70\nMIG:drizzle.__drizzle_migrations_hub:71\nMIG:drizzle.__drizzle_migrations_dev:3\nMIG:drizzle.__drizzle_migrations_pack_dlc:2\n";
    const applied = parseApplied(out);
    expect(applied.map((a) => a.count)).toEqual([70, 71, 2]);
    const c = compareMigrations(applied, {
      migrations: 70,
      "migrations-hub": 72,
      "migrations-pack-dlc": undefined,
    });
    expect(c.map((x) => x.ok)).toEqual([true, false, true]);
    expect(c[1]).toMatchObject({ applied: 71, expected: 72 });
  });

  it("journalCount, healthOk", () => {
    expect(journalCount(JSON.stringify({ entries: [{}, {}, {}] }))).toBe(3);
    expect(journalCount("không phải json")).toBe(0);
    expect(healthOk({ host: "a", status: 200 })).toBe(true);
    expect(healthOk({ host: "a", status: 502 })).toBe(false);
    expect(healthOk({ host: "a", status: "down" })).toBe(false);
  });

  it("errorLogSummary: đếm theo dịch vụ, bỏ level=info, che token/mật khẩu", () => {
    const log = [
      'hub-api-1  | {"level":"error","msg":"boom","token":"abc123"}',
      'hub-api-1  | {"level":"info","msg":"error budget ok"}',
      "admin-api-1  | Unhandled rejection: Authorization: Bearer sk-secret",
      "web-1  | hello",
    ].join("\n");
    const s = errorLogSummary(log);
    expect(s.total).toBe(2);
    expect(s.byService).toEqual({ "hub-api": 1, "admin-api": 1 });
    expect(s.samples.join("\n")).not.toContain("abc123");
    expect(s.samples.join("\n")).not.toContain("sk-secret");
    expect(redact("password=hunter2 ok")).toBe("password=*** ok");
  });
});

describe("verify · slice / wave / tóm tắt", () => {
  it("clip: ≤ 10 dòng, dòng cuối báo phần bị ẩn; render json không cắt", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `l${i}`);
    expect(clip(lines)).toHaveLength(10);
    expect(clip(lines).at(-1)).toContain("+5 dòng");
    expect(clip(["a"])).toEqual(["a"]);
    expect(JSON.parse(render(true, { n: 14 }, lines))).toEqual({ n: 14 });
    expect(render(false, {}, lines).split("\n")).toHaveLength(10);
  });

  it("newRedLines / legSummary: lấy đỏ mới, bỏ tiền tố [server:N:step], bỏ trùng", () => {
    const text = [
      "  [server:1:e2e]   NEW [e2e:root-0] x.spec.ts › y",
      "  NEW [e2e:root-0] x.spec.ts › y",
      "  known [e2e:root-0] m4-usage.spec.ts › E6 — cũ",
      "test:e2e:par: 1 đỏ MỚI (không nằm trong tests/known-red.json còn hạn):",
      "2 bước xanh, 10.0 s",
    ].join("\n");
    expect(newRedLines(text)).toEqual([
      "NEW [e2e:root-0] x.spec.ts › y",
      "test:e2e:par: 1 đỏ MỚI (không nằm trong tests/known-red.json còn hạn):",
    ]);
    expect(legSummary(text).summary).toBe("2 bước xanh, 10.0 s");
    expect(legSummary("rỗng").summary).toContain("không có dòng tổng kết");
  });

  it("sliceVerdict: cả hai chân 0 ⇒ XANH; chân server đỏ ⇒ ĐỎ và in đỏ mới; ≤ 10 dòng sau render", () => {
    const leg = (mode: "local" | "server", code: number, newReds: string[] = []) => ({
      mode,
      code,
      seconds: 1,
      summary: "s",
      newReds,
    });
    expect(sliceVerdict([leg("local", 0), leg("server", 0)]).ok).toBe(true);
    const bad = sliceVerdict([leg("local", 0), leg("server", 1, ["NEW [int] a"])]);
    expect(bad.ok).toBe(false);
    expect(bad.lines.join("\n")).toContain("[server] NEW [int] a");
  });

  it("waveFilters: thư mục sạch ⇒ tiền tố; thư mục có file bị bỏ ⇒ từng file; không trùng với thư mục cha", () => {
    const all = [
      "tests/a/x.int.test.ts",
      "tests/a/y.int.test.ts",
      "tests/b/p.int.test.ts",
      "tests/b/q.int.test.ts",
      "tests/b/sub/r.int.test.ts",
      "tests/c/z.int.test.ts",
    ];
    const kept = all.filter(
      (f) => f !== "tests/b/sub/r.int.test.ts" && f !== "tests/c/z.int.test.ts",
    );
    expect(waveFilters(kept, all)).toEqual([
      "tests/a/",
      "tests/b/p.int.test.ts",
      "tests/b/q.int.test.ts",
    ]);
    expect(waveFilters(all, all)).toEqual(["tests/a/", "tests/b/", "tests/c/"]);
  });

  it("waveVerdict: không đỏ mới + mọi lệnh 0 ⇒ XANH; ngược lại ĐỎ kèm đỏ mới", () => {
    const base = { ints: 100, jobs: ["root", "N1"], seconds: 5 };
    const ok = waveVerdict({
      ...base,
      results: [{ name: "server:1:int", ok: true, ms: 1000 }],
      newReds: [],
    });
    expect(ok.ok).toBe(true);
    const bad = waveVerdict({
      ...base,
      results: [{ name: "server:1:e2e", ok: false, ms: 1000 }],
      newReds: ["NEW [e2e:root-0] z"],
    });
    expect(bad.ok).toBe(false);
    expect(bad.lines[0]).toContain("1 đỏ mới");
  });
});

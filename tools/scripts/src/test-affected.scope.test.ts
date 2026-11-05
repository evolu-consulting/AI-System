// tool-affected-modules · luật chọn theo module (hàm thuần, bảng): SQL chỉ-thêm, file gốc theo loại, migration gói, strict, e2e theo gói.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planAffected } from "./test-affected.rules";
import {
  affectedScoped,
  buildScope,
  classifyRoot,
  closureWhy,
  PACK_MODULES,
  packageJsonKind,
  type ScopeDeps,
} from "./test-affected.scope";
import { analyzeSql, tableRefs } from "./test-affected.sql";

const root = join(import.meta.dir, "../../..");

describe("analyzeSql (chỉ thêm ⇒ theo bảng; đổi đối tượng sẵn có ⇒ rộng)", () => {
  const cases: [string, string, boolean][] = [
    [
      "bảng mới + RLS + policy",
      "CREATE TABLE hub.t_new (id uuid); ALTER TABLE hub.t_new ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON hub.t_new USING (true);",
      true,
    ],
    ["chỉ mục mới", "CREATE INDEX IF NOT EXISTS i ON hub.runs (tenant_id);", true],
    ["thêm cột", "ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS note text;", true],
    ["backfill DML", "INSERT INTO hub.slots SELECT 1 FROM hub.other ON CONFLICT DO NOTHING;", true],
    ["chú thích + dấu ; trong chuỗi", "-- a;b\nCOMMENT ON TABLE hub.x IS 'a;b';", true],
    ["đổi kiểu cột", "ALTER TABLE hub.runs ALTER COLUMN a TYPE int;", false],
    ["thêm ràng buộc", "ALTER TABLE hub.runs ADD CONSTRAINT c CHECK (a>0);", false],
    ["DROP", "DROP TABLE hub.runs;", false],
    ["policy bảng cũ", "CREATE POLICY p ON hub.runs USING (true);", false],
    ["hàm", "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ select 1; $$ LANGUAGE sql;", false],
    ["khối DO", "DO $$ BEGIN null; END $$;", false],
    ["view thay thế", "CREATE OR REPLACE VIEW v AS SELECT 1;", false],
  ];
  for (const [name, sql, scoped] of cases)
    test(name, () => expect(analyzeSql(sql).scoped).toBe(scoped));

  test("liệt kê bảng chạm tới (kể cả bảng trong subquery của DML)", () => {
    const r = analyzeSql(
      "DELETE FROM hub.a h WHERE EXISTS (SELECT 1 FROM hub.b r WHERE r.x = h.x);",
    );
    expect(r.tables).toEqual(expect.arrayContaining(["hub.a", "a", "hub.b", "b"]));
  });
  test("tableRefs: nháy, schema.bảng, snake/camel; tên ngắn chỉ khi có schema", () => {
    const re = tableRefs(["hub.process_routings", "hub.ab"]);
    expect(re?.test('from("process_routings")')).toBe(true);
    expect(re?.test("select * from hub.process_routings")).toBe(true);
    expect(re?.test("processRoutings.id")).toBe(true);
    expect(re?.test("hub.ab")).toBe(true);
    expect(re?.test("const ab = 1")).toBe(false);
  });
});

describe("file gốc theo loại", () => {
  const rows: [string, ReturnType<typeof classifyRoot>][] = [
    ["biome.json", "format"],
    ["tsconfig.json", "typecheck"],
    ["tsconfig.tests.json", "typecheck"],
    ["lefthook.yml", "none"],
    ["CLAUDE.md", "none"],
    ["bun.lock", "deps"],
    ["bunfig.int.toml", "deps"],
    ["lạ.xyz", "unknown"],
  ];
  for (const [f, k] of rows) test(`${f} ⇒ ${k}`, () => expect(classifyRoot(f)).toBe(k));
  test("package.json: deps vs scripts vs không đổi vs hỏng", () => {
    const a = '{"scripts":{"a":"1"},"dependencies":{"x":"1"}}';
    expect(packageJsonKind(a, '{"scripts":{"a":"2"},"dependencies":{"x":"1"}}')).toBe("scripts");
    expect(packageJsonKind(a, '{"scripts":{"a":"1"},"dependencies":{"x":"2"}}')).toBe("deps");
    expect(packageJsonKind(a, a)).toBe("none");
    expect(packageJsonKind(a, "{")).toBe("unknown");
  });
});

const graph = {
  deps: new Map([
    ["tools/a.ts", []],
    ["apps/x.ts", []],
  ]) as Map<string, string[]>,
};
function scopeOf(changed: string[], opts: Partial<ScopeDeps> = {}, all: string[] = []) {
  return buildScope(
    {
      changed,
      strict: false,
      graph,
      readFile: () => undefined,
      readBase: () => undefined,
      ...opts,
    },
    all,
  );
}

describe("buildScope", () => {
  test("docs/lefthook ⇒ không seed", () => {
    const s = scopeOf(["docs/WORKFLOW.md", "lefthook.yml"]);
    expect(s.broad.size + s.module.size).toBe(0);
  });
  test("biome/depcruise/lefthook/*.md/tests/.lock ⇒ bỏ qua hoàn toàn (không seed, không unit-tất-cả)", () => {
    const b = scopeOf([
      "biome.json",
      ".dependency-cruiser.cjs",
      ".dependency-cruiser-known-violations.json",
      "lefthook.yml",
      "README.md",
      "apps/x/NOTES.md",
      "tests/.lock",
      "docs/specs/a/tasks.md",
    ]);
    expect([b.unitAll, b.typecheckAll, b.broad.size, b.module.size]).toEqual([false, false, 0, 0]);
    expect(b.expand).toEqual([]);
    expect(b.ignored).toContain("tests/.lock");
    expect(b.ignored).toContain("biome.json");
  });
  test("tsconfig ⇒ typecheck tất cả + lý do mở rộng; bun.lock ⇒ mọi unit + lý do", () => {
    const t = scopeOf(["tsconfig.json"]);
    expect([t.typecheckAll, t.unitAll, t.broad.size]).toEqual([true, false, 0]);
    expect(t.expand.join("\n")).toContain("tsconfig.json");
    const l = scopeOf(["bun.lock"]);
    expect(l.unitAll).toBe(true);
    expect(l.expand.join("\n")).toContain("bun.lock");
  });
  test("barrel packages/contracts ⇒ vẫn rộng, kèm lý do trong expand", () => {
    const s = scopeOf(["packages/contracts/src/index.ts"]);
    expect(s.broad.has("packages/contracts/src/index.ts")).toBe(true);
    expect(s.expand.join("\n")).toContain("packages/contracts/src/index.ts");
  });
  test("package.json chỉ đổi scripts ⇒ không seed, không unit-tất-cả (ghi vào ignored)", () => {
    const s = scopeOf(["package.json"], {
      readBase: () => '{"scripts":{"a":"1"}}',
      readFile: () => '{"scripts":{"a":"2"}}',
    });
    expect(s.broad.size).toBe(0);
    expect(s.unitAll).toBe(false);
    expect(s.ignored[0]).toContain("package.json");
  });
  test("package.json đổi phụ thuộc ⇒ vẫn rộng", () => {
    const s = scopeOf(["package.json"], {
      readBase: () => '{"dependencies":{"x":"1"}}',
      readFile: () => '{"dependencies":{"x":"2"}}',
    });
    expect(s.unitAll).toBe(true);
    expect(s.broad.has("package.json")).toBe(true);
  });
  test("file gốc lạ ⇒ rộng + ghi chú", () => {
    const s = scopeOf(["lạ.xyz"]);
    expect(s.broad.has("lạ.xyz") && s.unitAll && s.notes.length > 0).toBe(true);
  });
  test("migration gói community ⇒ chỉ test của gói + meta, e2e community-web", () => {
    const all = [
      "apps/hub-api/src/modules/packs/community/adapters/a.int.test.ts",
      "apps/hub-api/src/modules/packs/contracts/adapters/b.int.test.ts",
      "packages/db/src/hub-rls.int.test.ts",
    ];
    const s = scopeOf(["packages/db/migrations-pack-community/0010_x.sql"], {}, all);
    expect([...s.module.keys()]).toEqual([all[0] as string]);
    expect([...s.extraInt.keys()]).toEqual([all[2] as string]);
    expect([...s.extraE2e.keys()]).toEqual(["e2e/community-web/*"]);
    expect(s.broad.size).toBe(0);
  });
  test("migration lõi chỉ-thêm ⇒ theo bảng, có DROP ⇒ rộng (MIGRATION_SEEDS)", () => {
    const all = [
      "apps/hub-api/src/modules/foo/a.int.test.ts",
      "apps/hub-api/src/modules/bar/b.int.test.ts",
    ];
    const read = (f: string) =>
      f === all[0]
        ? "sql`select * from hub.t_new`"
        : f.endsWith(".sql")
          ? "CREATE TABLE hub.t_new (id int);"
          : "";
    const ok = scopeOf(["packages/db/migrations-hub/0100_n.sql"], { readFile: read }, all);
    expect([...ok.module.keys()]).toEqual([all[0] as string]);
    expect(ok.broad.size).toBe(0);
    const bad = scopeOf(
      ["packages/db/migrations-hub/0100_n.sql"],
      { readFile: () => "DROP TABLE hub.x;" },
      all,
    );
    expect(bad.broad.has("packages/db/src/migrate-hub.ts")).toBe(true);
    const edited = scopeOf(["packages/db/migrations-hub/0001_o.sql"], {
      readFile: () => "CREATE TABLE hub.t (id int);",
      readBase: () => "old",
    });
    expect(edited.migrationBroad).toBe(true);
  });
  test("thư mục migration lạ ⇒ rộng", () => {
    expect(scopeOf(["packages/db/migrations-zzz/0001.sql"]).migrationBroad).toBe(true);
  });
  test("--strict giữ hành vi cũ: migration ⇒ MIGRATION_SEEDS, package.json ⇒ unit tất cả", () => {
    const s = scopeOf(["packages/db/migrations-pack-community/0010_x.sql", "package.json"], {
      strict: true,
    });
    expect(s.broad.has("packages/db/src/migrate.ts") && s.unitAll && s.strict).toBe(true);
  });
});

describe("bao đóng + e2e", () => {
  const rev = new Map<string, Set<string>>([
    ["pkg/lib.ts", new Set(["m/a.ts", "app.ts"])],
    ["m/a.ts", new Set(["m/a.int.test.ts"])],
    ["app.ts", new Set(["other.int.test.ts"])],
  ]);
  test("cắt ở file lắp ráp: không kéo test boot cả app", () => {
    const seeds = new Map([["pkg/lib.ts", "x"]]);
    expect([...closureWhy({ rev }, seeds)].map(([f]) => f).sort()).toContain("other.int.test.ts");
    const cut = closureWhy({ rev }, seeds, (f) => f === "app.ts");
    expect(cut.has("other.int.test.ts")).toBe(false);
    expect(cut.has("m/a.int.test.ts")).toBe(true);
  });
  test("affectedScoped ghi lý do `seed ← luật`", () => {
    const s = scopeOf(["pkg/lib.ts"]);
    const { why } = affectedScoped({ rev }, s, ["pkg/lib.ts"]);
    expect(why.get("m/a.int.test.ts")).toBe("pkg/lib.ts ← file đổi");
  });
  test("planAffected: file của gói không kéo combine; extraE2e + extraInt vào kế hoạch", () => {
    const s = scopeOf(["packages/db/migrations-pack-community/0010_x.sql"], {}, [
      "packages/db/src/migrate.int.test.ts",
    ]);
    const files = new Set([
      "apps/hub-api/src/modules/packs/community/adapters/x.ts",
      "packages/db/src/migrate.int.test.ts",
    ]);
    const plan = planAffected({
      changed: [],
      affected: files,
      e2eAffected: new Set(),
      scope: s,
      infos: [
        { config: "e2e/combine/playwright.config.ts" },
        { config: "e2e/community-web/playwright.config.ts" },
      ],
      exists: () => true,
      ignoredUnit: () => false,
      ignoredInt: () => false,
      opts: { e2e: "owner" },
    });
    expect(plan.e2e).toEqual(["e2e/community-web/playwright.config.ts"]);
    expect(plan.int).toEqual(["packages/db/src/migrate.int.test.ts"]);
    expect(plan.reasons["e2e/community-web/playwright.config.ts"]).toContain("gói community");
  });
});

describe("bảng PACK_MODULES khớp mã thật", () => {
  test("đủ mọi gói trong PACK_DIRS (migrate-packs.ts)", () => {
    const src = readFileSync(join(root, "packages/db/src/migrate-packs.ts"), "utf8");
    const keys = [...src.matchAll(/key:\s*"(\w+)"/g)].map((m) => m[1]);
    for (const k of keys) expect(Object.keys(PACK_MODULES)).toContain(k as string);
  });
  test("mọi cấu hình e2e và tiền tố thư mục tồn tại", () => {
    for (const m of Object.values(PACK_MODULES)) {
      for (const c of m.e2e) {
        const path = c.replace(/\*$/, "");
        expect(existsSync(join(root, path))).toBe(true);
      }
      for (const p of m.prefixes) expect(existsSync(join(root, p.replace(/\/$/, "")))).toBe(true);
    }
  });
});

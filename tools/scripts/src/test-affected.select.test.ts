// tool-test-select · chọn test: file gốc "không ảnh hưởng runtime" bị bỏ qua; mở rộng thật có lý do; cảnh báo > 150 file.
import { describe, expect, test } from "bun:test";
import { planAffected, TOO_MANY } from "./test-affected.rules";
import { affectedScoped, buildScope, isNoRuntime } from "./test-affected.scope";

const graph = { deps: new Map<string, string[]>(), rev: new Map<string, Set<string>>() };

function planOf(changed: string[], extra: string[] = [], pkg?: [string, string]) {
  const scope = buildScope(
    {
      changed,
      strict: false,
      graph: { deps: new Map(extra.map((f) => [f, []])) },
      readFile: () => pkg?.[1],
      readBase: () => pkg?.[0],
    },
    extra,
  );
  const { affected, why } = affectedScoped(graph, scope, changed);
  for (const f of extra) affected.add(f);
  return planAffected({
    changed,
    affected,
    scope,
    why,
    e2eAffected: new Set(),
    infos: [],
    exists: () => true,
    ignoredUnit: () => false,
    ignoredInt: () => false,
    opts: { e2e: "owner" },
  });
}

describe("isNoRuntime", () => {
  for (const f of [
    "docs/a/b.md",
    "CLAUDE.md",
    "tests/.lock",
    "biome.json",
    "lefthook.yml",
    ".dependency-cruiser.cjs",
    ".dependency-cruiser-known-violations.json",
  ])
    test(`${f} ⇒ bỏ qua`, () => expect(isNoRuntime(f)).toBe(true));
  for (const f of ["tsconfig.json", "bun.lock", "package.json", "tests/acceptance/a.test.ts"])
    test(`${f} ⇒ KHÔNG bỏ qua`, () => expect(isNoRuntime(f)).toBe(false));
});

describe("planAffected với file gốc kiểu cấu hình", () => {
  test("chỉ đổi cấu hình/tài liệu/khoá ⇒ không unit-tất-cả, không typecheck, không typecheck:tests", () => {
    const p = planOf(
      [
        "package.json",
        "biome.json",
        "lefthook.yml",
        ".dependency-cruiser.cjs",
        "tests/.lock",
        "docs/specs/x/tasks.md",
        "CLAUDE.md",
      ],
      [],
      ['{"scripts":{"a":"1"}}', '{"scripts":{"a":"2"}}'],
    );
    expect(p.unit).toEqual([]);
    expect(p.int).toEqual([]);
    expect(p.typecheck).toBe(false);
    expect(p.typecheckTests).toBe(false);
    expect(p.expansions).toEqual([]);
    expect(p.ignored.length).toBe(6); // docs/** im lặng (SILENT) nên không vào danh sách
  });

  test("tsconfig đổi ⇒ vẫn mở rộng typecheck, kèm lý do", () => {
    const p = planOf(["tsconfig.json"]);
    expect(p.typecheckAll).toBe(true);
    expect(p.expansions.join(" ")).toContain("tsconfig.json");
  });

  test("bun.lock đổi ⇒ vẫn chạy mọi unit, kèm lý do", () => {
    const p = planOf(["bun.lock"]);
    expect(p.unit).toEqual(["*"]);
    expect(p.expansions.join(" ")).toContain("bun.lock");
  });
});

describe(`cảnh báo > ${TOO_MANY} file`, () => {
  const tests = (n: number) => Array.from({ length: n }, (_, i) => `apps/a/src/t${i}.int.test.ts`);
  test("nhiều hơn mức ⇒ có ghi chú gợi ý chạy cuối đợt", () => {
    const p = planOf(["apps/a/src/x.ts"], tests(TOO_MANY + 1));
    expect(p.notes.join(" ")).toContain("cuối đợt");
  });
  test("đúng mức ⇒ không cảnh báo", () => {
    const p = planOf(["apps/a/src/x.ts"], tests(TOO_MANY));
    expect(p.notes.join(" ")).not.toContain("cuối đợt");
  });
});

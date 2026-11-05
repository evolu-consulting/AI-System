import { describe, expect, test } from "bun:test";
import {
  classify,
  compare,
  countByTargetModule,
  findViolations,
  fromBaseline,
  joinRelative,
  moduleOf,
  relativeSpecifiers,
  toBaseline,
  totalsByRule,
} from "./check-boundaries.rules";

const M = "apps/hub-api/src/modules/";

describe("CR-121 B · ADR-0037 · classify (luật ranh giới module hub-api)", () => {
  test("module của đường dẫn; mỗi gói packs/<x> là một module", () => {
    expect(moduleOf(`${M}knowledge/domain/a.ts`)).toBe("knowledge");
    expect(moduleOf(`${M}packs/kit/adapters/a.ts`)).toBe("packs/kit");
    expect(moduleOf(`${M}packs/packs.mount.ts`)).toBe("packs");
    expect(moduleOf("apps/hub-api/src/lib/db.ts")).toBeNull();
  });

  test("import sâu / phẳng vào module khác = vi phạm; cùng module hoặc qua public.ts = hợp lệ", () => {
    const from = `${M}artifacts/artifact.service.ts`;
    expect(classify(from, `${M}knowledge/application/ports.ts`)).toBe("cross-module-deep");
    expect(classify(from, `${M}config/config.service.ts`)).toBe("cross-module-flat");
    expect(classify(from, `${M}knowledge/public.ts`)).toBeNull();
    expect(classify(from, `${M}artifacts/artifact.repo.ts`)).toBeNull();
    expect(classify(`${M}packs/community/a.ts`, `${M}packs/kit/adapters/x.ts`)).toBe(
      "cross-module-deep",
    );
    expect(classify(`${M}packs/community/a.ts`, `${M}packs/kit/public.ts`)).toBeNull();
  });

  test("file gốc modules/packs/*.ts nối gói của chính module packs; ngược lại gói → file gốc là phẳng", () => {
    expect(classify(`${M}packs/packs.after-mount.ts`, `${M}packs/kit/adapters/x.ts`)).toBeNull();
    expect(classify(`${M}packs/kit/adapters/x.ts`, `${M}packs/packs.filebox.ts`)).toBe(
      "cross-module-flat",
    );
  });

  test("miễn: *.mount.ts, file test, ngoài modules/", () => {
    const to = `${M}knowledge/adapters/ai.adapters.ts`;
    expect(classify(`${M}artifacts/artifact.mount.ts`, to)).toBeNull();
    expect(classify(`${M}packs/packs.mount.ts`, to)).toBeNull();
    expect(classify(`${M}artifacts/a.int.test.ts`, to)).toBeNull();
    expect(classify(`${M}artifacts/a.perf.int.test.ts`, to)).toBeNull();
    expect(classify("apps/hub-api/src/app.ts", to)).toBeNull();
    expect(classify("apps/admin-api/src/x.ts", to)).toBeNull();
  });

  test("production không import testing/; test và testing/ thì được", () => {
    const fake = `${M}knowledge/testing/fake-embedder.ts`;
    expect(classify(`${M}artifacts/artifact.service.ts`, fake)).toBe("no-prod-import-testing");
    expect(classify(`${M}artifacts/artifact.mount.ts`, fake)).toBe("no-prod-import-testing");
    expect(classify(`${M}knowledge/knowledge.mount.ts`, fake)).toBe("no-prod-import-testing");
    expect(classify("apps/hub-api/src/lib/x.ts", fake)).toBe("no-prod-import-testing");
    expect(classify(`${M}artifacts/artifact.int.test.ts`, fake)).toBeNull();
    expect(classify(`${M}artifacts/testing/fake.ts`, fake)).toBeNull();
  });
});

describe("CR-121 B · quét import", () => {
  test("lấy specifier tương đối: import/export from, side-effect, dynamic, nhiều dòng; bỏ package", () => {
    const src = [
      'import { a } from "../x/a";',
      'import type { B } from "./b";',
      "import {\n  c,\n  d,\n} from '../y/c';",
      'export { e } from "../z/e";',
      'import "./side";',
      'const m = await import("../dyn/m");',
      'import { zod } from "zod";',
      'const s = "../not/import";',
    ].join("\n");
    expect(relativeSpecifiers(src).sort()).toEqual(
      ["../dyn/m", "../x/a", "../y/c", "../z/e", "./b", "./side"].sort(),
    );
  });

  test("joinRelative chuẩn hoá .. và .", () => {
    expect(joinRelative(`${M}a/b/c.ts`, "../../d/e")).toBe(`${M}d/e`);
    expect(joinRelative(`${M}a/c.ts`, "./x")).toBe(`${M}a/x`);
  });

  test("findViolations resolve .ts và index.ts, bỏ trùng, bỏ miễn trừ", () => {
    const sources = new Map<string, string>([
      [
        `${M}artifacts/artifact.service.ts`,
        'import { A } from "../knowledge/application/ports";\nimport type { A2 } from "../knowledge/application/ports";',
      ],
      [`${M}artifacts/artifact.mount.ts`, 'import { x } from "../knowledge/adapters/ai.adapters";'],
      [`${M}artifacts/artifact.repo.ts`, 'import { n } from "../config";'],
      [`${M}knowledge/application/ports.ts`, ""],
      [`${M}knowledge/adapters/ai.adapters.ts`, ""],
      [`${M}config/index.ts`, ""],
    ]);
    expect(findViolations(sources)).toEqual([
      {
        rule: "cross-module-deep",
        from: `${M}artifacts/artifact.service.ts`,
        to: `${M}knowledge/application/ports.ts`,
      },
      {
        rule: "cross-module-flat",
        from: `${M}artifacts/artifact.repo.ts`,
        to: `${M}config/index.ts`,
      },
    ]);
  });
});

describe("CR-121 B · so với baseline (chỉ được co lại)", () => {
  const v = (rule: "cross-module-deep" | "cross-module-flat", n: string) => ({
    rule,
    from: `${M}a/${n}.ts`,
    to: `${M}b/${n}.ts`,
  });

  test("vi phạm mới ⇒ added (đỏ); vi phạm cũ đã hết ⇒ fixed (co baseline)", () => {
    const base = [v("cross-module-deep", "1"), v("cross-module-flat", "2")];
    const cur = [v("cross-module-flat", "2"), v("cross-module-flat", "3")];
    const c = compare(cur, base);
    expect(c.added).toEqual([v("cross-module-flat", "3")]);
    expect(c.fixed).toEqual([v("cross-module-deep", "1")]);
    expect([c.current, c.baseline]).toEqual([2, 2]);
  });

  test("đếm không tăng nhưng thay vi phạm khác vẫn bị bắt; baseline giống hệt ⇒ sạch", () => {
    const base = [v("cross-module-deep", "1")];
    expect(compare([v("cross-module-deep", "9")], base).added).toHaveLength(1);
    const same = compare(base, base);
    expect(same.added).toHaveLength(0);
    expect(same.fixed).toHaveLength(0);
  });
});

describe("CR-121 B · khuôn baseline và đếm theo module", () => {
  const v = (rule: "cross-module-deep" | "cross-module-flat", n: string) => ({
    rule,
    from: `${M}a/${n}.ts`,
    to: `${M}b/${n}.ts`,
  });

  test("baseline khứ hồi theo khuôn depcruise; mục luật khác bị bỏ qua", () => {
    const vs = [v("cross-module-deep", "1")];
    const known = toBaseline(vs);
    expect(known[0]).toEqual({
      type: "dependency",
      from: vs[0]?.from,
      to: vs[0]?.to,
      rule: { severity: "error", name: "cross-module-deep" },
    });
    const other = {
      type: "dependency",
      from: "x",
      to: "y",
      rule: { severity: "error", name: "no-circular" },
    };
    expect(fromBaseline([...known, other as never])).toEqual(vs);
  });

  test("đếm theo module đích và theo loại", () => {
    const vs = [
      { rule: "cross-module-deep" as const, from: `${M}a/x.ts`, to: `${M}knowledge/domain/d.ts` },
      { rule: "cross-module-flat" as const, from: `${M}a/x.ts`, to: `${M}config/c.ts` },
      { rule: "cross-module-flat" as const, from: `${M}b/x.ts`, to: `${M}config/d.ts` },
    ];
    expect(countByTargetModule(vs)[0]).toEqual({
      module: "config",
      deep: 0,
      flat: 2,
      testing: 0,
      total: 2,
    });
    expect(totalsByRule(vs)).toEqual({
      "cross-module-deep": 1,
      "cross-module-flat": 2,
      "no-prod-import-testing": 0,
    });
  });
});

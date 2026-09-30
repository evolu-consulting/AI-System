import { describe, expect, test } from "bun:test";
import {
  buildTrace,
  checkGaps,
  isCodeFile,
  isTestFile,
  parseCatalog,
  parseSpecs,
  renderTraceMd,
  scanRefs,
  splitPrelude,
  testRefs,
} from "./trace";

// Dựng tên hàm test qua biến: nguồn file này không chứa nguyên văn tên test của mã khác (T-TRACE-2).
const IT = "it";
const DESCRIBE = "describe";

const CATALOG = [
  "| Mã | Yêu cầu | Ưu tiên |",
  "|---|---|---|",
  "| ADM-FR-01 | A | **MUST** |",
  "| ADM-FR-02 | B **đậm** giữa | **SHOULD** |",
  "| ADM-BR-03 | C |",
  "| ADM-FR-01 | trùng, bỏ | **COULD** |",
  "| HUB-NFR-100 | D | **WON'T** |",
  "không phải dòng bảng ADM-FR-09",
].join("\n");

const spec = (reqs: string, status: string) =>
  `---\nid: X\nrequirements: [${reqs}]\nstatus: ${status}\n---\n# X\n`;

describe("ADM-NFR-06 · trace parse (T-TRACE-1, T-TRACE-2)", () => {
  test("parseCatalog: ưu tiên ở ô cuối, không có → —, bỏ trùng", () => {
    expect(parseCatalog([{ path: "docs/design/a/ba-a.md", text: CATALOG }])).toEqual([
      { id: "ADM-FR-01", priority: "MUST" },
      { id: "ADM-FR-02", priority: "SHOULD" },
      { id: "ADM-BR-03", priority: "—" },
      { id: "HUB-NFR-100", priority: "WON'T" },
    ]);
  });

  test("parseSpecs: đọc requirements + status, bỏ _template và spec không có mã", () => {
    expect(
      parseSpecs([
        { path: "docs/specs/S1/spec.md", text: spec("ADM-FR-01, ADM-FR-02", "in-progress") },
        { path: "docs/specs/_template/spec.md", text: spec("ADM-FR-01", "approved") },
        { path: "docs/specs/S2/spec.md", text: spec("", "approved") },
        { path: "docs/specs/S3/spec.md", text: "# không frontmatter\n" },
      ]),
    ).toEqual([
      {
        path: "docs/specs/S1/spec.md",
        status: "in-progress",
        requirements: ["ADM-FR-01", "ADM-FR-02"],
      },
    ]);
  });

  test("testRefs: mã trong path hoặc đầu tên test; dữ liệu/comment/mã dài hơn không tính", () => {
    const text = [
      `${IT}("ADM-FR-01 · a", () => {});`,
      `${DESCRIBE}(\n  \`HUB-FR-10 · b\`, () => {});`,
      `${IT}('ADM-FR-040 · dài hơn', () => {});`,
      "// ADM-FR-05 trong comment",
      'const x = "ADM-FR-06";',
      `sub${IT}("ADM-FR-07 · submit( không phải it(")`,
    ].join("\n");
    expect(testRefs("tests/acceptance/ADM-NFR-06/x.test.ts", text).sort()).toEqual([
      "ADM-FR-01",
      "ADM-FR-040",
      "ADM-NFR-06",
      "HUB-FR-10",
    ]);
  });

  test("isTestFile / isCodeFile", () => {
    expect(isTestFile("tests/acceptance/X/_helpers.ts")).toBe(true);
    expect(isTestFile("e2e/a.spec.ts")).toBe(true);
    expect(isTestFile("apps/a/src/b.test.tsx")).toBe(true);
    expect(isCodeFile("apps/a/src/b.ts")).toBe(true);
    expect(isCodeFile("apps/a/src/b.test.ts")).toBe(false);
    expect(isCodeFile("apps/a/README.md")).toBe(false);
    expect(isCodeFile("docs/x.ts")).toBe(false);
  });

  test("scanRefs bỏ __fixtures__", () => {
    const refs = scanRefs(
      [
        { path: "apps/a/src/x.ts", text: "// ADM-FR-01" },
        { path: "apps/a/src/__fixtures__/y.ts", text: "// ADM-FR-01" },
      ],
      "code",
    );
    expect(refs.get("ADM-FR-01")).toEqual(["apps/a/src/x.ts"]);
  });
});

describe("ADM-NFR-06 · trace build/render (T-TRACE-3, T-TRACE-4)", () => {
  const catalog = parseCatalog([{ path: "docs/design/a/ba-a.md", text: CATALOG }]);
  const rows = buildTrace({
    catalog,
    specs: [
      {
        path: "docs/specs/S1/spec.md",
        status: "approved",
        requirements: ["ADM-FR-01", "ADM-FR-02"],
      },
    ],
    code: new Map([["ADM-FR-02", ["apps/a/src/y.ts"]]]),
    tests: new Map([["ADM-BR-03", ["tests/a.test.ts"]]]),
  });

  test("trạng thái: test cần spec; mức cao nhất đạt được", () => {
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["ADM-FR-01", "có spec"],
      ["ADM-FR-02", "có code"],
      ["ADM-BR-03", "chưa spec"],
      ["HUB-NFR-100", "chưa spec"],
    ]);
  });

  test("checkGaps: MUST thuộc spec approved thiếu test", () => {
    expect(checkGaps(rows).map((r) => r.id)).toEqual(["ADM-FR-01"]);
    const draft = rows.map((r) => ({
      ...r,
      specs: r.specs.map((s) => ({ ...s, status: "draft" })),
    }));
    expect(checkGaps(draft)).toEqual([]);
  });

  test("splitPrelude giữ nguyên byte trước `| FR |`; không có → 3 dòng đầu", () => {
    expect(splitPrelude("# T\r\n\r\nmô tả\n\n| FR | x |\n|---|\n")).toBe("# T\r\n\r\nmô tả\n\n");
    expect(splitPrelude("a\nb\nc\nd\n")).toBe("a\nb\nc\n");
  });

  test("renderTraceMd: prelude + bảng, mỗi mã một dòng", () => {
    const md = renderTraceMd("# T\n\n", rows);
    expect(md.startsWith("# T\n\n| FR | Ưu tiên |")).toBe(true);
    expect(md).toContain("| ADM-FR-02 | SHOULD | docs/specs/S1/spec.md | 1 file |  | có code |\n");
    expect(
      md.split("\n").filter((l) => l.startsWith("| ADM-") || l.startsWith("| HUB-")),
    ).toHaveLength(4);
  });
});

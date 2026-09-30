import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, removeRepo, run, scriptPath } from "./_helpers";

// Dựng tên hàm test qua biến: nguồn file này không chứa nguyên văn `it("<mã khác>` (T-TRACE-2 vế b).
const IT = "it";
const TEST = "test";
const DESCRIBE = "describe";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

const spec = (id: string, reqs: string[], status: string) =>
  `---\nid: ${id}\nrequirements: [${reqs.join(", ")}]\nstatus: ${status}\n---\n# ${id}\n`;

const CATALOG = [
  "# BA mẫu",
  "| Mã | Yêu cầu | Ưu tiên |",
  "|---|---|---|",
  "| ADM-FR-01 | Tạo tenant | **MUST** |",
  "| ADM-FR-02 | Xem báo cáo | **SHOULD** |",
  "| ADM-BR-03 | Quy tắc làm tròn | |",
  "| ADM-FR-04 | Khoá tài khoản | **MUST** |",
  "| ADM-FR-05 | Nhập CSV | **MUST** |",
  "| ADM-FR-06 | Mẫu | **MUST** |",
  "",
].join("\n");

// Phần mở đầu trước dòng `| FR |` (T-TRACE-4): tiêu đề, dòng trống, 2 dòng mô tả, dòng trống.
const TRACE_PREFIX =
  "# TRACE — yêu cầu → spec → code → test\n\n" +
  "Sinh tự động bằng `bun run trace`. Không sửa tay.\n" +
  "Dòng mô tả thứ hai giữ nguyên.\n\n";
const TABLE_HEAD =
  "| FR | Ưu tiên | Spec | Code | Test | Trạng thái |\n|---|---|---|---|---|---|\n";

function base(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "docs/design/demo/ba-demo.md": CATALOG,
    "docs/TRACE.md": `${TRACE_PREFIX}${TABLE_HEAD}| ADM-FR-99 | cũ | | | | dòng cũ phải bị ghi đè |\n`,
    "docs/specs/S1/spec.md": spec("S1", ["ADM-FR-01", "ADM-FR-02"], "approved"),
    "docs/specs/S3/spec.md": spec("S3", ["ADM-FR-05"], "draft"),
    "docs/specs/_template/spec.md": spec("_template", ["ADM-FR-06"], "approved"),
    "apps/admin-api/src/x.ts": "// ADM-FR-01\nexport const x = 1;\n",
    "apps/admin-api/src/y.ts": "// ADM-FR-02\nexport const y = 1;\n",
    // (a) mã trong path
    "tests/acceptance/ADM-FR-01/a.test.ts": "export {};\n",
    // (b) mã ở đầu tên test
    "tests/acceptance/misc/br.test.ts": `import { it } from "bun:test";\n${IT}("ADM-BR-03 · luật", () => {});\n`,
    ...extra,
  };
}

function repo(extra: Record<string, string> = {}): string {
  const dir = makeRepo(base(extra));
  dirs.push(dir);
  return dir;
}
const trace = (dir: string, ...args: string[]) =>
  run(["bun", scriptPath("trace.ts"), ...args], dir);
const rowOf = (md: string, id: string) =>
  md.split("\n").filter((l) => new RegExp(`\\b${id}\\b`).test(l));
const traceMd = (dir: string) => readFileSync(join(dir, "docs/TRACE.md"), "utf8");

// S2 approved nhận ADM-FR-04; mã này chỉ xuất hiện trong dữ liệu/comment/__fixtures__/mã dài hơn.
const FR04_NOT_TESTED: Record<string, string> = {
  "docs/specs/S2/spec.md": spec("S2", ["ADM-FR-04"], "approved"),
  "tests/acceptance/misc/data.test.ts":
    'import { expect, it } from "bun:test";\n' +
    "// ADM-FR-04 chỉ là dữ liệu mẫu trong comment\n" +
    'const sample = { code: "ADM-FR-04", row: "| ADM-FR-04 | Khoá tài khoản |" };\n' +
    `${IT}("ADM-NFR-06 · dùng dữ liệu mẫu", () => {\n  expect(sample.code).toBe("ADM-FR-04");\n});\n`,
  "e2e/data.spec.ts": 'export const label = "ADM-FR-04";\n',
  "tests/acceptance/misc/longer.test.ts": `${IT}("ADM-FR-040 · mã khác, dài hơn", () => {});\n`,
  "tests/acceptance/__fixtures__/f.test.ts": `${IT}("ADM-FR-04 · nằm trong fixture", () => {});\n`,
  "tools/scripts/src/__fixtures__/trace/ADM-FR-04.test.ts": "export {};\n",
  "apps/admin-api/src/__fixtures__/z.ts": "// ADM-FR-04\nexport const z = 1;\n",
};

describe("ADM-NFR-06 · M0-AC14 · trace (T-TRACE-1..4)", () => {
  it("ADM-NFR-06 · M0-AC14 · `trace` ghi TRACE.md, giữ nguyên từng byte phần mở đầu trước `| FR |`, mỗi mã một dòng", () => {
    const dir = repo();
    const r = trace(dir);
    expect(r.code).toBe(0);
    const md = traceMd(dir);
    expect(md.startsWith(TRACE_PREFIX)).toBe(true);
    expect(md.slice(TRACE_PREFIX.length).startsWith("| FR |")).toBe(true);
    expect(md).not.toContain("dòng cũ phải bị ghi đè");
    const r01 = rowOf(md, "ADM-FR-01");
    expect(r01).toHaveLength(1);
    expect(r01[0]).toContain("MUST");
    expect(r01[0]).toContain("có test"); // test theo path (vế a)
    expect(rowOf(md, "ADM-FR-02")[0]).toContain("SHOULD");
    expect(rowOf(md, "ADM-FR-02")[0]).toContain("có code");
    expect(rowOf(md, "ADM-FR-05")[0]).toContain("có spec"); // spec draft vẫn tính là có spec
    expect(rowOf(md, "ADM-BR-03")[0]).toContain("chưa spec"); // có test (vế b) nhưng không spec nào nhận
    expect(rowOf(md, "ADM-BR-03")[0]).toContain("—"); // không ghi ưu tiên
    expect(rowOf(md, "ADM-FR-06")[0]).toContain("chưa spec"); // _template bị bỏ qua
  });

  it("ADM-NFR-06 · M0-AC14 · TRACE.md không có dòng `| FR |` → giữ 3 dòng đầu", () => {
    const dir = repo({ "docs/TRACE.md": "# TRACE\n\nMô tả một dòng.\nDòng thứ tư.\n" });
    expect(trace(dir).code).toBe(0);
    expect(traceMd(dir).split("\n").slice(0, 3)).toEqual(["# TRACE", "", "Mô tả một dòng."]);
    expect(rowOf(traceMd(dir), "ADM-FR-01")).toHaveLength(1);
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: file test chứa mã FR chỉ trong dữ liệu mẫu/comment KHÔNG được tính là có test", () => {
    const dir = repo(FR04_NOT_TESTED);
    expect(trace(dir).code).toBe(0);
    const row = rowOf(traceMd(dir), "ADM-FR-04");
    expect(row).toHaveLength(1);
    expect(row[0]).toContain("có spec"); // __fixtures__ cũng không làm thành "có code"
    expect(row[0]).not.toContain("có test");
    expect(row[0]).not.toContain("có code");
    const one = trace(dir, "ADM-FR-04");
    expect(one.code).toBe(0);
    expect(one.out).not.toContain("tests/acceptance/misc/data.test.ts");
    expect(one.out).not.toContain("e2e/data.spec.ts");
    expect(one.out).not.toContain("tests/acceptance/misc/longer.test.ts");
    expect(one.out).not.toContain("__fixtures__");
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: --check vẫn chặn khi ADM-FR-04 chỉ có trong dữ liệu mẫu / __fixtures__", () => {
    const r = trace(repo(FR04_NOT_TESTED), "--check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("ADM-FR-04");
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: tên describe/test bắt đầu bằng mã (backtick, nháy đơn, xuống dòng) được tính", () => {
    for (const body of [
      `${DESCRIBE}(\n  \`ADM-FR-04 · nhóm\`, () => {});\n`,
      `${TEST}('ADM-FR-04 · một ca', () => {});\n`,
    ]) {
      const dir = repo({ ...FR04_NOT_TESTED, "tests/acceptance/misc/real.test.ts": body });
      expect(trace(dir).code).toBe(0);
      expect(rowOf(traceMd(dir), "ADM-FR-04")[0]).toContain("có test");
      expect(trace(dir, "--check").code).toBe(0);
    }
  });

  it("ADM-NFR-06 · M0-AC14 · `trace <mã>` in ưu tiên, spec, trạng thái, exit 0, KHÔNG ghi file", () => {
    const dir = repo();
    const before = traceMd(dir);
    const r = trace(dir, "ADM-FR-01");
    expect(r.code).toBe(0);
    expect(r.out).toContain("docs/specs/S1/spec.md");
    expect(r.out).toContain("MUST");
    expect(r.out).toContain("có test");
    expect(traceMd(dir)).toBe(before);
  });

  it("ADM-NFR-06 · M0-AC14 · `trace <mã lạ>` → exit 1, 'Không tìm thấy <mã>'", () => {
    const r = trace(repo(), "ADM-FR-999");
    expect(r.code).toBe(1);
    expect(r.out).toContain("Không tìm thấy ADM-FR-999");
  });

  it("ADM-NFR-06 · M0-AC14 · mã 4 chữ số không khớp regex (\\d{2,3}) nên không được coi là mã", () => {
    const dir = repo({ "apps/admin-api/src/z.ts": "// ADM-FR-1234\n" });
    expect(trace(dir, "ADM-FR-1234").code).toBe(1);
  });

  it("ADM-NFR-06 · M0-AC14 · --check: MUST thuộc spec approved / in-progress / done mà thiếu test → exit 1 và liệt kê mã", () => {
    for (const status of ["approved", "in-progress", "done"]) {
      const dir = repo({ "docs/specs/S2/spec.md": spec("S2", ["ADM-FR-04"], status) });
      const r = trace(dir, "--check");
      expect(r.code).toBe(1);
      expect(r.out).toContain("ADM-FR-04");
      expect(r.out).not.toContain("ADM-FR-05"); // spec draft không bị chặn
      expect(r.out).not.toContain("ADM-FR-01"); // đã có test
    }
  });

  it("ADM-NFR-06 · M0-AC14 · --check: đủ test (hoặc SHOULD/không ưu tiên/spec draft) → exit 0", () => {
    expect(trace(repo(), "--check").code).toBe(0);
  });

  it("ADM-NFR-06 · M0-AC14 · `trace` không đối số lần 2 cho cùng kết quả (idempotent)", () => {
    const dir = repo();
    expect(trace(dir).code).toBe(0);
    const first = traceMd(dir);
    expect(trace(dir).code).toBe(0);
    expect(traceMd(dir)).toBe(first);
  });
});

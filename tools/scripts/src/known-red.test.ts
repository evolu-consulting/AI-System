// Đỏ đã biết có hạn: khớp, hết hạn, tách tóm tắt mới/cũ, mã thoát, đọc log bun test, và file seed thật hợp lệ.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  containsId,
  exitCode,
  formatSplit,
  intReds,
  isExpired,
  type KnownRed,
  newCount,
  parseKnownRed,
  pytestReds,
  quarantineOn,
  splitReds,
} from "./known-red.rules";

const mk = (over: Partial<KnownRed> = {}): KnownRed => ({
  id: "m4-usage.spec.ts › E6",
  suite: "e2e:root",
  reason: "cũ",
  owner: "admin-web",
  expires: "2026-11-17",
  since: "2026-10-21",
  ...over,
});
const TODAY = "2026-11-03";

describe("known-red · khớp và hết hạn", () => {
  it("containsId khớp theo ranh giới, không phân biệt hoa/thường và dấu gạch", () => {
    expect(containsId("workflows.spec.ts › a", "workflows.spec.ts")).toBe(true);
    expect(containsId("e2e/x/workflows.spec.ts › a", "workflows.spec.ts")).toBe(true);
    expect(containsId("conflict-workflows.spec.ts › a", "workflows.spec.ts")).toBe(false);
    expect(containsId("a › E6 · tenant", "e6")).toBe(true);
    expect(containsId("tests\\a\\db.int.test.ts › t", "tests/a/db.int.test.ts")).toBe(true);
  });

  it("isExpired: còn hiệu lực hết ngày expires, sau đó hết hạn", () => {
    expect(isExpired(mk({ expires: "2026-11-03" }), TODAY)).toBe(false);
    expect(isExpired(mk({ expires: "2026-11-02" }), TODAY)).toBe(true);
  });

  it("splitReds: khớp mục còn hạn ⇒ known; mục hết hạn ⇒ expired (tính mới); không khớp hoặc sai suite ⇒ fresh", () => {
    const entries = [mk(), mk({ id: "old.spec.ts", expires: "2026-11-01" })];
    const reds = [
      { suite: "e2e:root-0", name: "m4-usage.spec.ts › E6 · tenant_admin" },
      { suite: "e2e:root-1", name: "old.spec.ts › x" },
      { suite: "e2e:chat", name: "m4-usage.spec.ts › E6 · tenant_admin" },
      { suite: "e2e:root-0", name: "brand-new.spec.ts › y" },
    ];
    const s = splitReds(reds, entries, TODAY);
    expect(s.known.map((h) => h.red.name)).toEqual(["m4-usage.spec.ts › E6 · tenant_admin"]);
    expect(s.expired.map((h) => h.red.name)).toEqual(["old.spec.ts › x"]);
    expect(s.fresh.map((r) => r.suite + "|" + r.name)).toEqual([
      "e2e:chat|m4-usage.spec.ts › E6 · tenant_admin",
      "e2e:root-0|brand-new.spec.ts › y",
    ]);
    expect(newCount(s, 0)).toBe(3);
    expect(newCount(s, 2)).toBe(5);
  });

  it("suite `*` khớp mọi suite; mục còn hạn thắng mục hết hạn cùng id", () => {
    const s = splitReds(
      [{ suite: "int", name: "a.int.test.ts › K2" }],
      [mk({ id: "K2", suite: "*", expires: "2026-10-01" }), mk({ id: "K2", suite: "int" })],
      TODAY,
    );
    expect(s.known).toHaveLength(1);
    expect(s.expired).toHaveLength(0);
  });
});

describe("known-red · tóm tắt và mã thoát", () => {
  const entries = [mk()];
  const known = { suite: "e2e:root-0", name: "m4-usage.spec.ts › E6 · x" };
  const fresh = { suite: "e2e:root-0", name: "other.spec.ts › z" };

  it("chỉ đỏ cũ: quarantine ⇒ 0, nghiêm ⇒ 1; in dòng 'đỏ cũ' không có 'MỚI'", () => {
    const s = splitReds([known], entries, TODAY);
    expect(exitCode(s, 0, true)).toBe(0);
    expect(exitCode(s, 0, false)).toBe(1);
    const text = formatSplit("L", s, 0).join("\n");
    expect(text).toContain("1 đỏ cũ");
    expect(text).not.toContain("MỚI");
  });

  it("có đỏ mới (hoặc lượt đỏ không rút được tên) ⇒ 1 kể cả quarantine; đỏ MỚI in trước đỏ cũ", () => {
    const s = splitReds([known, fresh], entries, TODAY);
    expect(exitCode(s, 0, true)).toBe(1);
    expect(exitCode(splitReds([known], entries, TODAY), 1, true)).toBe(1);
    const lines = formatSplit("L", s, 0);
    expect(lines[0]).toContain("1 đỏ MỚI");
    expect(lines[1]).toContain("NEW [e2e:root-0] other.spec.ts › z");
    expect(lines.findIndex((l) => l.includes("đỏ cũ"))).toBeGreaterThan(1);
  });

  it("mục hết hạn in là NEW kèm ngày hết hạn; không đỏ ⇒ không dòng nào, mã 0", () => {
    const s = splitReds([known], [mk({ expires: "2026-10-30" })], TODAY);
    expect(formatSplit("L", s, 0).join("\n")).toContain("HẾT HẠN 2026-10-30");
    expect(exitCode(s, 0, true)).toBe(1);
    const none = splitReds([], entries, TODAY);
    expect(formatSplit("L", none, 0)).toEqual([]);
    expect(exitCode(none, 0, true)).toBe(0);
  });

  it("quarantineOn: cờ, env, --no-quarantine thắng", () => {
    expect(quarantineOn([], {})).toBe(false);
    expect(quarantineOn(["--quarantine"], {})).toBe(true);
    expect(quarantineOn([], { TEST_QUARANTINE: "1" })).toBe(true);
    expect(quarantineOn(["--no-quarantine"], { TEST_QUARANTINE: "1" })).toBe(false);
  });
});

describe("known-red · đọc dữ liệu", () => {
  it("parseKnownRed: lỗi nêu rõ trường thiếu / ngày sai", () => {
    expect(() => parseKnownRed("{}")).toThrow("entries");
    expect(() => parseKnownRed(JSON.stringify({ entries: [{ id: "a" }] }))).toThrow("suite");
    expect(() =>
      parseKnownRed(JSON.stringify({ entries: [{ ...mk(), expires: "17/11" }] })),
    ).toThrow("YYYY-MM-DD");
    expect(parseKnownRed(JSON.stringify({ entries: [mk()] }))).toHaveLength(1);
  });

  it("intReds: lấy ca (fail) kèm file từ dòng tiêu đề, bỏ [thời gian]", () => {
    const log = [
      "tests/acceptance/H1/db.int.test.ts:",
      "(pass) ok [3.00ms]",
      "(fail) A48–A51 · migration Hub và quyền [HUB-FR-75] > chạy [12.50ms]",
      "tests\\acceptance\\K2\\readers.int.test.ts:",
      "(fail) K2 · màn đọc > v2 xác nhận [1.00s]",
    ].join("\n");
    expect(intReds(log)).toEqual([
      {
        suite: "int",
        name: "tests/acceptance/H1/db.int.test.ts › A48–A51 · migration Hub và quyền [HUB-FR-75] > chạy",
      },
      {
        suite: "int",
        name: "tests/acceptance/K2/readers.int.test.ts › K2 · màn đọc > v2 xác nhận",
      },
    ]);
  });

  it("pytestReds: FAILED/ERROR của pytest -rfE → suite py, bỏ phần ' - lý do', giữ ca tham số", () => {
    const log = [
      "tests/runtime/test_a.py ..F",
      "=========== short test summary info ===========",
      "FAILED tests/runtime/test_a.py::test_x - assert 1 == 2",
      "FAILED src/agent_runtime/q/test_b.py::TestK::test_y[p-1] - AssertionError",
      "ERROR tests/acceptance/foo_int_test.py::test_z",
      "1 failed, 2 passed",
    ].join("\n");
    expect(pytestReds(log)).toEqual([
      { suite: "py", name: "tests/runtime/test_a.py › test_x" },
      { suite: "py", name: "src/agent_runtime/q/test_b.py › TestK::test_y[p-1]" },
      { suite: "py", name: "tests/acceptance/foo_int_test.py › test_z" },
    ]);
    const known = mk({ id: "tests/runtime/test_a.py › test_x", suite: "py" });
    expect(splitReds(pytestReds(log), [known], TODAY).fresh).toHaveLength(2);
  });

  it("ảnh chụp known-red (fixture): hợp lệ, đủ trường, hết hạn 2026-11-17, id không trùng, khớp ca mẫu", () => {
    const text = readFileSync(
      resolve(import.meta.dir, "__fixtures__/known-red.snapshot.json"),
      "utf8",
    );
    const entries = parseKnownRed(text);
    expect(entries.length).toBeGreaterThanOrEqual(15);
    expect(entries.every((e) => e.expires >= "2026-11-17")).toBe(true);
    expect(new Set(entries.map((e) => e.suite + e.id)).size).toBe(entries.length);
    const s = splitReds(SAMPLE_REDS, entries, "2026-11-03");
    expect(s.known).toHaveLength(5);
    expect(s.fresh).toHaveLength(2);
    // hết hạn ⇒ cả năm thành đỏ mới
    expect(
      splitReds(
        s.known.map((h) => h.red),
        entries,
        "2026-11-18",
      ).expired,
    ).toHaveLength(5);
  });
});

const SAMPLE_REDS = [
  {
    suite: "e2e:root-2",
    name: "m4-usage.spec.ts › M4-R07 · M4-R08 · E7 · region 'Top feature theo số thu'",
  },
  {
    suite: "e2e:root-1",
    name: "cr052-login.spec.ts › [CR-052] công tắc EN/VI đổi sang tiếng Việt",
  },
  {
    suite: "int",
    name: "packages/db/src/migrate-hub.int.test.ts › HUB-FR-75 · runHubMigrations (int, ai_system_h1_test) > DB sạch (production): main → hub đủ bảng",
  },
  {
    suite: "int",
    name: "apps/hub-api/src/modules/chat-gate/chat-gate.int.test.ts › (unnamed)",
  },
  {
    suite: "int",
    name: "tests/acceptance/V2-G/perf.int.test.ts › V2-G perf > thời gian: Lưu 200 dòng + 50 mốc (tenant tắt duyệt) — p95",
  },
  { suite: "e2e:root-0", name: "m4-usage.spec.ts › E9 · ca không có trong danh sách" },
  {
    suite: "int",
    name: "packages/db/src/migrate-hub.int.test.ts › HUB-FR-75 · role + GRANT (int) > x",
  },
];

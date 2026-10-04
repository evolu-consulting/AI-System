// HUB-H1-AC-01 · `done:h1`: bước đúng test-plan H1 §7.1, URL DB Python, dừng ở bước chặn đỏ, bảng tóm tắt.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatTable,
  h1Steps,
  overallGreen,
  pyDbUrl,
  pythonCommand,
  type Result,
  shouldRun,
} from "./done-h1";

const PLAN = readFileSync(
  join(import.meta.dir, "../../../docs/specs/H1-hub-core/test-plan.md"),
  "utf8",
);
/** Khối lệnh §7.1, gộp dòng tiếp nối `\`, bỏ chú thích `#`. */
const block71 = (() => {
  const sec = PLAN.slice(PLAN.indexOf("### 7.1"), PLAN.indexOf("### 7.2"));
  const code = sec.slice(sec.indexOf("```") + 3, sec.lastIndexOf("```"));
  return code
    .replace(/\\\n\s*/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
})();

describe("HUB-H1-AC-01 · done:h1 — bước theo test-plan §7.1", () => {
  const steps = h1Steps({});

  it("HUB-H1-AC-01 · mọi bước chặn có nguyên văn trong §7.1 (dòng `&&` cuối tách bước), đúng thứ tự", () => {
    const flat = block71.flatMap((l) =>
      l.startsWith("bun run test:lock") ? l.split(" && ") : [l],
    );
    const titles = steps.filter((s) => s.blocking).map((s) => s.title.replace(/\s+/g, " "));
    expect(titles).toEqual(flat.map((l) => l.replace(/\s+/g, " ")));
  });

  it("HUB-H1-AC-01 · hai lệnh chỉ báo cáo đứng sau, không chặn", () => {
    expect(steps.filter((s) => !s.blocking).map((s) => s.title)).toEqual([
      "tsc -p tsconfig.tests.json",
      "bun run depcruise --all",
    ]);
  });

  it("HUB-H1-AC-01 · contract chat chạy với Hub thật :4000, auth :3001, user fixture JSON", () => {
    const k = steps.find((s) => s.title.includes("test:contract:chat"));
    expect(k?.needsDev).toBe(true);
    expect(k?.env?.HUB_URL).toBe("http://localhost:4000");
    expect(k?.env?.AUTH_URL).toBe("http://localhost:3001");
    expect(Object.keys(JSON.parse(k?.env?.CHAT_CONTRACT_USERS ?? "{}")).sort()).toEqual(
      ["a", "b", "locked", "other_tenant"].sort(),
    );
  });
});

describe("HUB-H1-AC-01 · done:h1 — Python trong container", () => {
  const owner = "postgres://ai:ai_dev_pw@localhost:5432/ai_system_h1_test";

  it("HUB-H1-AC-01 · không phải Linux → host postgres:5432; Linux giữ nguyên", () => {
    expect(pyDbUrl("postgres://ai:pw@localhost:15432/ai_system_h1_test", "win32")).toBe(
      "postgres://ai:pw@postgres:5432/ai_system_h1_test",
    );
    expect(pyDbUrl(owner, "linux")).toBe(owner);
  });

  it("HUB-H1-AC-01 · chuỗi lệnh export cả hai URL DB test (cùng DB h1) trước lệnh §7.1", () => {
    const cmd = pythonCommand({ HUB_TEST_DATABASE_URL: owner }, "win32");
    expect(cmd).toStartWith(
      "export HUB_TEST_DATABASE_URL='postgres://ai:ai_dev_pw@postgres:5432/ai_system_h1_test' " +
        "AGENT_RT_TEST_DATABASE_URL='postgres://agent_runtime:agent_runtime_dev_pw@postgres:5432/ai_system_h1_test'",
    );
    expect(cmd).toEndWith("uv run pytest && uv run pytest -m int");
  });
});

describe("HUB-H1-AC-01 · done:h1 — dừng ở bước chặn đỏ, bảng tóm tắt", () => {
  const [a, b] = h1Steps({});
  const report = h1Steps({}).at(-1);
  if (!a || !b || !report) throw new Error("thiếu bước");
  const r = (step: typeof a, outcome: Result["outcome"]): Result => ({ step, outcome, ms: 1500 });

  it("HUB-H1-AC-01 · sau bước chặn đỏ: bước chặn không chạy, bước báo cáo vẫn chạy", () => {
    expect(shouldRun(b, true)).toBe(false);
    expect(shouldRun(report, true)).toBe(true);
    expect(shouldRun(b, false)).toBe(true);
  });

  it("HUB-H1-AC-01 · kết quả: báo cáo đỏ không làm đỏ; chặn đỏ/chưa chạy thì đỏ", () => {
    expect(overallGreen([r(a, "xanh"), r(b, "xanh"), r(report, "đỏ")])).toBe(true);
    expect(overallGreen([r(a, "đỏ"), r(b, "chưa chạy"), r(report, "xanh")])).toBe(false);
    expect(overallGreen([r(a, "xanh"), r(b, "chưa chạy")])).toBe(false);
  });

  it("HUB-H1-AC-01 · bảng in kết quả, thời gian, loại bước; 'chưa chạy' không có thời gian", () => {
    const t = formatTable([r(a, "đỏ"), r(b, "chưa chạy"), r(report, "xanh")], false);
    expect(t).toContain(" 1  đỏ           1.5s  [chặn] bunx turbo run typecheck");
    expect(t).toContain(" 2  chưa chạy       -  [chặn] bun test");
    expect(t).toContain("[báo cáo] bun run depcruise --all");
  });
});

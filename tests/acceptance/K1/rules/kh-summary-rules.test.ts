// HUB-FR-133 · K1-AC05 · K1-AC07 · CR-073 · plan K1 §2.5 (`kh.summary.rules.ts`) · spec §2 (Ghi worklog, `## Tóm tắt`), §3.0
// (`/vector/add`), §3.4, §4 `snapshot.kh` · §9 Q8/Q32 · test-plan K1 §4 R70–R77. Module vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import { fn, loadSummary } from "./_rules";

const m = await loadSummary();
const T = {
  connection_id: "c1a10000-0000-4000-8000-000000000041",
  name: "kh-main",
  project: "proj-a",
};
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("R70–R74 · nội dung + định danh ghi [spec §2 · §3.0 · Q32]", () => {
  it("HUB-FR-133 · R70 · summaryForWorklog: lấy đúng mục '## Tóm tắt' (tới heading kế), trim; không có / rỗng ⇒ null", () => {
    const f = fn(m, "summaryForWorklog");
    expect(f("## Bảng ý\nx\n\n## Tóm tắt\n  Đã đối chiếu HD-12.  \n\n## Bàn giao\nH")).toBe(
      "Đã đối chiếu HD-12.",
    );
    expect(f("## Tóm tắt\nCuối tài liệu.")).toBe("Cuối tài liệu.");
    expect(f("## Bảng ý\nx\n\n## Bàn giao\nH")).toBeNull();
    expect(f("## Tóm tắt\n\n## Bàn giao\nH")).toBeNull();
  });
  it("HUB-FR-133 · R71 · summaryForWorklog cắt 200 từ và ≤ 4000 ký tự; clipWords(s, n) giữ n từ đầu", () => {
    const f = fn(m, "summaryForWorklog");
    const w250 = Array.from({ length: 250 }, (_, i) => `w${i}`).join(" ");
    const r = f(`## Tóm tắt\n${w250}`);
    expect(r.startsWith("w0 w1 w2")).toBe(true);
    expect(r.includes("w200")).toBe(false);
    expect(words(r).length).toBeLessThanOrEqual(200);
    const long = f(`## Tóm tắt\n${Array.from({ length: 150 }, () => "x".repeat(40)).join(" ")}`);
    expect(long.length).toBeLessThanOrEqual(4000);
    const c = fn(m, "clipWords");
    expect(c("a b c d", 4)).toBe("a b c d");
    const cut = c("a b c d", 2);
    expect([cut.startsWith("a b"), cut.includes("c")]).toEqual([true, false]);
  });
  it("HUB-FR-133 · K1-AC05 · R72 · worklogSubject = '<quy trình>/<stage>', cắt 128", () => {
    const f = fn(m, "worklogSubject");
    expect(f("sdlc-delivery", "spec")).toBe("sdlc-delivery/spec");
    expect(f("p".repeat(100), "s".repeat(100))).toHaveLength(128);
  });
  it("HUB-FR-133 · K1-AC05 · Q32 · R73 · worklogVectorId = kw-<process_run>-<stage_run>-v<phiên bản output>", () => {
    expect(fn(m, "worklogVectorId")("run1", "sr1", 3)).toBe("kw-run1-sr1-v3");
  });
  it("HUB-FR-133 · R74 · khWorklogBody = body /vector/add spec §3.0 (scope log, metadata.topic = subject, source ai-hub)", () => {
    const ts = "2026-10-13T08:00:00.000Z";
    expect(
      fn(
        m,
        "khWorklogBody",
      )({
        id: "kw-r-s-v1",
        project: "proj-a",
        subject: "k1-auto/a0",
        text: "Tóm tắt",
        ts,
      }),
    ).toEqual({
      id: "kw-r-s-v1",
      text: "Tóm tắt",
      scope: "log",
      metadata: {
        scope: "log",
        project: "proj-a",
        subject: "k1-auto/a0",
        topic: "k1-auto/a0",
        ts,
        source: "ai-hub",
      },
    });
  });
});

describe("R75–R77 · đích Tóm tắt lúc start [spec §3.4 · §4 snapshot.kh · Q8]", () => {
  it("HUB-FR-133 · K1-AC07 · R75 · ensureSummary: needed ⇒ thêm 'Tóm tắt' (không trùng); không needed ⇒ giữ nguyên", () => {
    const f = fn(m, "ensureSummary");
    expect(f(["Bảng ý"], true)).toEqual(["Bảng ý", "Tóm tắt"]);
    expect(f(["Tóm tắt", "Bảng ý"], true)).toEqual(["Tóm tắt", "Bảng ý"]);
    expect(f(["Bảng ý"], false)).toEqual(["Bảng ý"]);
  });
  it("HUB-FR-133 · Q8 · R76 · planKhSnapshot: stage executor ≠ agent ⇒ null; mọi phần tử null ⇒ null", () => {
    const f = fn(m, "planKhSnapshot");
    const st = [
      { executor: { kind: "agent" } },
      { executor: { kind: "team" } },
      { executor: { kind: "agent" } },
    ];
    expect(f(st, [T, T, null])).toEqual({ stages: [T, null, null] });
    expect(f(st, [null, T, null])).toBeNull();
    expect(f(st, [null, null, null])).toBeNull();
  });
  it("HUB-FR-133 · Q34 · R77 · shouldWriteSummary: cần đích ≠ null ∧ kết nối còn dùng được", () => {
    const f = fn(m, "shouldWriteSummary");
    expect(f(T, { connectionUsable: true })).toBe(true);
    expect(f(T, { connectionUsable: false })).toBe(false);
    expect(f(null, { connectionUsable: true })).toBe(false);
  });
});

// HUB-FR-114 · HUB-FR-110 · D7 · D8 · R-T01…R-T06 — luật nhóm (runs/team.rules.ts, plan-contract §7).
import { describe, expect, it } from "bun:test";
import { fn, loadProcRules } from "../../_support/modules";

const T = async (name: string) => fn(await loadProcRules("runs/team.rules.ts"), name);
const MEMBERS = [
  { key: "m1", sections: ["Phần A"] },
  { key: "m2", sections: ["Phần B"] },
  { key: "m3", sections: ["Phần C"] },
];
const step = (member: string, s: string) => ({ member, sections: [s], instruction: `Viết ${s}` });

describe("R-T · nhóm agent [HUB-FR-114, D7, D8]", () => {
  it("HUB-FR-114 · R-T01 · parseLeadPlan: hợp lệ 3 bước / json / empty / too_many (max 5) / unknown_member", async () => {
    const f = await T("parseLeadPlan");
    const ok = f(
      JSON.stringify([step("m1", "Phần A"), step("m2", "Phần B"), step("m3", "Phần C")]),
      MEMBERS,
      5,
    );
    expect(ok.ok).toBe(true);
    expect(ok.steps.map((s: { member: string }) => s.member)).toEqual(["m1", "m2", "m3"]);
    expect(f("xin chào", MEMBERS, 5)).toEqual({ ok: false, reason: "json" });
    expect(f("[]", MEMBERS, 5)).toEqual({ ok: false, reason: "empty" });
    const six = Array.from({ length: 6 }, (_, i) => step(`m${(i % 3) + 1}`, "Phần A"));
    expect(f(JSON.stringify(six), MEMBERS, 5)).toEqual({ ok: false, reason: "too_many" });
    expect(f(JSON.stringify([step("m9", "Phần A")]), MEMBERS, 5)).toEqual({
      ok: false,
      reason: "unknown_member",
    });
  });
  it("HUB-FR-114 · R-T02 · assembleSections: mục mới ⇒ changed; y hệt ⇒ không; mục không sở hữu ⇒ foreign, giữ bản cũ", async () => {
    const f = await T("assembleSections");
    const cur = new Map([
      ["Phần A", "A cũ"],
      ["Phần B", "B cũ"],
      ["Phần C", "C cũ"],
    ]);
    const a = f(cur, "## Phần A\nA mới", ["Phần A"]);
    expect(a.changed).toBe(true);
    expect(a.next.get("Phần A")).toContain("A mới");
    expect(a.foreign).toEqual([]);
    const b = f(cur, "## Phần A\nA cũ", ["Phần A"]);
    expect(b.changed).toBe(false);
    const c = f(cur, "## Phần A\nA mới\n\n## Phần B\nB lấn", ["Phần A"]);
    expect(c.foreign).toEqual(["Phần B"]);
    expect(c.next.get("Phần B")).toBe("B cũ");
    expect(c.next.get("Phần A")).toContain("A mới");
  });
  it("HUB-FR-114 · R-T03 · renderDoc: map đảo thứ tự ⇒ thứ tự theo template", async () => {
    const f = await T("renderDoc");
    const doc: string = f(
      "## Phần A\n\n## Phần B\n\n## Phần C\n",
      new Map([
        ["Phần C", "nội dung C"],
        ["Phần B", "nội dung B"],
        ["Phần A", "nội dung A"],
      ]),
    );
    const ia = doc.indexOf("## Phần A");
    const ib = doc.indexOf("## Phần B");
    const ic = doc.indexOf("## Phần C");
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ia < ib && ib < ic).toBe(true);
    expect(doc.indexOf("nội dung A")).toBeLessThan(doc.indexOf("nội dung B"));
  });
  it("HUB-FR-114 · R-T04 · clipSummary: 2 000 ký tự @200 token ⇒ ≤ 800 ký tự; 100 ký tự ⇒ giữ nguyên", async () => {
    const f = await T("clipSummary");
    expect(f("a".repeat(2000), 200).length).toBeLessThanOrEqual(800);
    const s = "b".repeat(100);
    expect(f(s, 200)).toBe(s);
  });
  it("HUB-FR-114 · R-T05 · redoMembers: sections [Phần B] ⇒ [m2]; góp ý nhắc `phần c` ⇒ [m3]; không khớp ⇒ cả nhóm (D8)", async () => {
    const f = await T("redoMembers");
    expect(f(MEMBERS, { sections: ["Phần B"], feedback: "Sửa lại" })).toEqual(["m2"]);
    expect(f(MEMBERS, { feedback: "Cần bổ sung phần c cho rõ" })).toEqual(["m3"]);
    expect(f(MEMBERS, { feedback: "Chưa ổn" })).toEqual(["m1", "m2", "m3"]);
  });
  it("HUB-FR-110 · R-T06 · mergeQuestions: 2 câu (m1, m2) ⇒ 1 câu chứa cả hai kèm vai", async () => {
    const f = await T("mergeQuestions");
    const r = f([
      { member: "m1", role: "Phân tích", question: "Định dạng ngày?" },
      { member: "m2", role: "Thiết kế", question: "Đơn vị tiền?" },
    ]);
    expect(typeof r.question).toBe("string");
    for (const s of ["Định dạng ngày?", "Đơn vị tiền?", "Phân tích", "Thiết kế"])
      expect(r.question).toContain(s);
    expect(Array.isArray(r.choices)).toBe(true);
  });
});

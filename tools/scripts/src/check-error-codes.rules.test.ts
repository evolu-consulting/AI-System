import { describe, expect, test } from "bun:test";
import { hubTextIssues, keyIssues } from "./check-error-codes.rules";

const set = [{ name: "t", codes: ["A_CODE"], prefix: "x.err" }];
const row = (key: string, lang: "vi" | "en" = "vi", file = "f.vi.json") => ({ file, lang, key });

describe("check:error-codes · khoá i18n", () => {
  test("đủ một khoá chuẩn mỗi ngôn ngữ ⇒ sạch", () => {
    expect(keyIssues(set, [row("x.err.A_CODE"), row("x.err.A_CODE", "en")])).toEqual([]);
  });
  test("thiếu khoá en ⇒ vi phạm; khai hai lần ⇒ vi phạm", () => {
    const miss = keyIssues(set, [row("x.err.A_CODE")]);
    expect(miss).toHaveLength(1);
    expect(miss[0]?.msg).toContain("thiếu");
    const dup = keyIssues(set, [
      row("x.err.A_CODE"),
      row("x.err.A_CODE"),
      row("x.err.A_CODE", "en"),
    ]);
    expect(dup[0]?.msg).toContain("2 lần");
  });
  test("khoá thứ hai cho cùng mã ⇒ vi phạm, trừ tiền tố riêng đã khai", () => {
    const base = [row("x.err.A_CODE"), row("x.err.A_CODE", "en")];
    const two = keyIssues(set, [...base, row("y.z.err.A_CODE")]);
    expect(two).toHaveLength(1);
    expect(two[0]?.msg).toContain("khoá thứ hai y.z.err.A_CODE");
    expect(keyIssues(set, [...base, row("y.z.err.A_CODE")], ["y.z.err."])).toEqual([]);
    expect(keyIssues(set, [...base, row("y.z.err.OTHER")])).toEqual([]);
  });
});

describe("check:error-codes · hub không chứa câu tiếng Việt", () => {
  const f = (src: string, name = "apps/hub-api/src/m/x.ts") => new Map([[name, src]]);
  test("câu tiếng Việt ngay sau mã ⇒ vi phạm (kể cả dạng khoá hàm)", () => {
    const a = hubTextIssues(f('STEPS_MAX: () => M(\n  "Quy trình có nhiều bước",\n)'), [
      "STEPS_MAX",
    ]);
    expect(a.map((i) => i.line)).toEqual([2]);
    const b = hubTextIssues(f('push({ rule: "STEPS_MAX", message: "Quá số bước" })'), [
      "STEPS_MAX",
    ]);
    expect(b).toHaveLength(1);
  });
  test("chú thích tiếng Việt, test, ngoài hub, hoặc xa mã ⇒ không tính", () => {
    expect(hubTextIssues(f('push({ rule: "STEPS_MAX" }) // Quá số bước'), ["STEPS_MAX"])).toEqual(
      [],
    );
    expect(
      hubTextIssues(f('rule: "STEPS_MAX", m: "Quá"', "apps/hub-api/src/x.test.ts"), ["STEPS_MAX"]),
    ).toEqual([]);
    expect(
      hubTextIssues(f('rule: "STEPS_MAX", m: "Quá"', "apps/admin-web/src/x.ts"), ["STEPS_MAX"]),
    ).toEqual([]);
    const far = `rule: "STEPS_MAX"\n${"\n".repeat(8)}const m = "Quá số bước";`;
    expect(hubTextIssues(f(far), ["STEPS_MAX"])).toEqual([]);
  });
});

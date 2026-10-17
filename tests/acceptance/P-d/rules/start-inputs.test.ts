// HUB-FR-144 · AC-H41 · test-plan §4 PD-U33…U35: input `date` khi start + hồi quy 4 kiểu cũ
// `P/domain/runs/start-inputs.rules.ts` (plan-domain §4.9: `isCalendarDate`, `startInputIssues`). Hành vi cũ suy từ contract
// `hub-admin/sources.ts` (INPUT_TYPES, options chỉ select) + test khoá `P-b/pfs3/inputs.int.test.ts` (IN-03, IN-05, IN-06).
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "runs/start-inputs.rules.ts";
const HAN = [{ key: "han", type: "date", required: true }];
const OLD = [
  { key: "repo", type: "source_ref", required: true },
  { key: "goal", type: "text", required: true },
  { key: "env", type: "select", required: false, options: ["dev", "stg"] },
  { key: "doc", type: "file", required: false },
];

describe("PD-U33…U34 · input date [plan-domain §4.9]", () => {
  it("AC-H41 · PD-U33 · isCalendarDate: chỉ YYYY-MM-DD có thật (nhuận đúng)", async () => {
    const f = await domainFn(REL, "isCalendarDate");
    const cases = [
      "2026-02-28",
      "2028-02-29",
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-2-3",
      "",
    ];
    expect(cases.map((s) => f(s))).toEqual([true, true, false, false, false, false, false]);
  });
  it("AC-H41 · PD-U34 · startInputIssues date: 2026-02-30 ⇒ [{index:0,path:value}]; 2026-02-28 ⇒ []; vắng (thiếu required) ⇒ [] như cũ", async () => {
    const f = await domainFn(REL, "startInputIssues");
    expect(f(HAN, [{ key: "han", type: "date", value: "2026-02-30" }])).toEqual([
      { index: 0, path: "value" },
    ]);
    expect(f(HAN, [{ key: "han", type: "date", value: "2026-02-28" }])).toEqual([]);
    // Hành vi cũ (IN-03): thiếu input required vẫn bắt đầu — không phải lỗi validate.
    expect(f(HAN, [])).toEqual([]);
  });
});

describe("PD-U35 · hồi quy 4 kiểu cũ [IN-05, IN-06]", () => {
  it("AC-H41 · PD-U35 · đủ text/select/file/source_ref hợp lệ ⇒ []", async () => {
    const f = await domainFn(REL, "startInputIssues");
    expect(
      f(OLD, [
        { key: "repo", type: "source_ref" },
        { key: "goal", type: "text", value: "Thêm nút xuất" },
        { key: "env", type: "select", value: "stg" },
        { key: "doc", type: "file" },
      ]),
    ).toEqual([]);
  });
  it("AC-H41 · PD-U35 · select ngoài options ⇒ path value; key không khai ⇒ path key; type lệch def ⇒ path type", async () => {
    const f = await domainFn(REL, "startInputIssues");
    expect(
      f(OLD, [
        { key: "goal", type: "text", value: "x" },
        { key: "env", type: "select", value: "prod" },
      ]),
    ).toEqual([{ index: 1, path: "value" }]);
    expect(f(OLD, [{ key: "khong-khai", type: "text", value: "x" }])).toEqual([
      { index: 0, path: "key" },
    ]);
    expect(f(OLD, [{ key: "goal", type: "select", value: "dev" }])).toEqual([
      { index: 0, path: "type" },
    ]);
  });
  it("AC-H41 · PD-U35 · thiếu input required (goal, repo) ⇒ [] (vẫn bắt đầu, IN-03)", async () => {
    const f = await domainFn(REL, "startInputIssues");
    expect(f(OLD, [{ key: "env", type: "select", value: "dev" }])).toEqual([]);
  });
});

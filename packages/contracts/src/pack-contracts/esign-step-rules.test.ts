// CR-125 · c1 · MỘT luật bước Ký số (hub + admin-web) + MỘT bộ câu lỗi: luật thuần, và câu lỗi trong i18n khớp bảng chung.
import { describe, expect, test } from "bun:test";
import { type EsignStepFacts, esignStepIssues } from "./esign-step-rules";
import { PUBLISH_ISSUE_CODES } from "./publish-issue-codes";

const ok: EsignStepFacts = {
  due_h: 72,
  remind_every_h: 24,
  signer_mode: "owner",
  hasGroup: false,
  hasUser: false,
};
const codes = (s: Partial<EsignStepFacts>, w: { index: number; count: number; ordinal?: number }) =>
  esignStepIssues({ ...ok, ...s }, w).map((x) => `${x.field}:${x.code}`);

describe("esignStepIssues", () => {
  test("hợp lệ: bước cuối, hạn/nhắc trong khoảng", () => {
    expect(codes({}, { index: 2, count: 3 })).toEqual([]);
  });
  test("không phải bước cuối ⇒ ESIGN_NOT_LAST; bước Ký số thứ hai ⇒ ESIGN_MULTI", () => {
    expect(codes({}, { index: 1, count: 3 })).toEqual(["step:ESIGN_NOT_LAST"]);
    expect(codes({}, { index: 2, count: 3, ordinal: 2 })).toEqual(["step:ESIGN_MULTI"]);
  });
  test("trưởng phòng ký thiếu phòng, người cụ thể thiếu người", () => {
    expect(codes({ signer_mode: "dept_head" }, { index: 0, count: 1 })).toEqual([
      "signer_group:SIGNER_GROUP_REQUIRED",
    ]);
    expect(codes({ signer_mode: "user" }, { index: 0, count: 1 })).toEqual([
      "signer_user:SIGNER_USER_REQUIRED",
    ]);
  });
  test("hạn 4–2160 giờ, nhắc 4–168 giờ (hoặc để trống)", () => {
    expect(codes({ due_h: 3 }, { index: 0, count: 1 })).toEqual(["due_h:DUE_RANGE"]);
    expect(codes({ remind_every_h: 169 }, { index: 0, count: 1 })).toEqual([
      "remind_every_h:REMIND_RANGE",
    ]);
    expect(codes({ remind_every_h: 3 }, { index: 0, count: 1 })).toEqual([
      "remind_every_h:REMIND_RANGE",
    ]);
    expect(codes({ remind_every_h: 168, due_h: 2160 }, { index: 0, count: 1 })).toEqual([]);
    expect(codes({ remind_every_h: null }, { index: 0, count: 1 })).toEqual([]);
  });
});

describe("mã lỗi bước Ký số nằm trong danh sách mã chung (mỗi mã một khoá i18n)", () => {
  test("mọi mã esignStepIssues phát ra đều có trong PUBLISH_ISSUE_CODES", () => {
    const bad = { ...ok, due_h: 1, remind_every_h: 1, signer_mode: "dept_head" };
    const out = esignStepIssues(bad, { index: 0, count: 2, ordinal: 2 });
    expect(out.length).toBeGreaterThan(3);
    for (const i of out) expect(PUBLISH_ISSUE_CODES).toContain(i.code);
    expect(PUBLISH_ISSUE_CODES).toContain("SIGNER_USER_REQUIRED");
  });
});

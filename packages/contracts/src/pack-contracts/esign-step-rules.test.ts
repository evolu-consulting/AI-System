// CR-125 · c1 · MỘT luật bước Ký số (hub + admin-web) + MỘT bộ câu lỗi: luật thuần, và câu lỗi trong i18n khớp bảng chung.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESIGN_STEP_TEXT, type EsignStepFacts, esignStepIssues } from "./esign-step-rules";

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

describe("ESIGN_STEP_TEXT khớp i18n (một bộ câu lỗi)", () => {
  const read = (rel: string) =>
    JSON.parse(readFileSync(join(import.meta.dir, "../../../i18n/locales", rel), "utf8"));
  test.each(["vi", "en"] as const)("contracts/esignflow.%s.json", (lng) => {
    const err = read(`contracts/esignflow.${lng}.json`).contracts.flow.err;
    for (const [code, t] of Object.entries(ESIGN_STEP_TEXT)) expect(err[code]).toBe(t[lng]);
  });
  test.each(["vi", "en"] as const)("process/admin.%s.json không còn bản riêng khác chữ", (lng) => {
    const s = JSON.stringify(read(`process/admin.${lng}.json`));
    for (const code of ["ESIGN_NOT_LAST", "SIGNER_GROUP_REQUIRED"] as const) {
      const m = new RegExp(`"${code}":"([^"]*)"`).exec(s);
      if (m) expect(m[1]).toBe(ESIGN_STEP_TEXT[code][lng]);
    }
  });
});

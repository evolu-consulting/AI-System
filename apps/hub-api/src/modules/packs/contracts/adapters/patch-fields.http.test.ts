// HD-AC07 · HD-AC06 · plan §1 bảng lỗi: map thân PATCH → 400/422 và kết quả use case → 200/404/409.
import { describe, expect, it } from "bun:test";
import { AppError } from "../../../../lib/errors";
import { patchBody, patchReply } from "./patch-fields.http";

function err(f: () => unknown): { code: string; status: number; details: unknown } {
  try {
    f();
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, status: e.status, details: e.details };
    throw e;
  }
  throw new Error("không ném");
}

describe("patchBody", () => {
  it("hợp lệ ⇒ đầu vào", () => {
    expect(patchBody({ version: 2, fields: { notice_days: 5 } })).toEqual({
      version: 2,
      fields: { notice_days: 5 },
    });
  });
  it("khoá lạ (kể cả lẫn khoá sai kiểu) ⇒ 422 FIELD_UNKNOWN {keys}", () => {
    expect(err(() => patchBody({ version: 1, fields: { x: 1, notice_days: "abc" } }))).toEqual({
      code: "FIELD_UNKNOWN",
      status: 422,
      details: { keys: ["x"] },
    });
  });
  it("sai kiểu ⇒ 422 FIELD_INVALID {key}", () => {
    expect(err(() => patchBody({ version: 1, fields: { end_date: "2027-02-30" } }))).toEqual({
      code: "FIELD_INVALID",
      status: 422,
      details: { key: "end_date" },
    });
  });
  it("sai hình gốc ⇒ 400 VALIDATION_ERROR", () => {
    for (const b of [
      { fields: { number: "A" } },
      { version: 1, fields: {} },
      { version: 0, fields: { number: "A" } },
      { version: 1, fields: { number: "A" }, tenant_id: "x" },
      { version: 1, fields: [] },
      null,
    ])
      expect(err(() => patchBody(b)).code).toBe("VALIDATION_ERROR");
  });
});

describe("patchReply", () => {
  it("not_found ⇒ 404, stale ⇒ 409 CONTRACT_STALE {current, updated_at}", () => {
    expect(err(() => patchReply({ kind: "not_found" })).status).toBe(404);
    expect(
      err(() =>
        patchReply({
          kind: "stale",
          current: { version: 3 },
          updated_at: "2026-10-19T00:00:00.000Z",
        }),
      ),
    ).toEqual({
      code: "CONTRACT_STALE",
      status: 409,
      details: { current: { version: 3 }, updated_at: "2026-10-19T00:00:00.000Z" },
    });
  });
});

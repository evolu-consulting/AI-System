// ADM-FR-55 · AC-A07 · parseConflict: chỉ VERSION_CONFLICT có details hợp lệ.
import { describe, expect, test } from "bun:test";
import { parseConflict, pickKeys } from "./conflict";
import { ApiError } from "./http";

const conflict = (details: unknown) => new ApiError(409, "VERSION_CONFLICT", "x", details);

describe("ADM-FR-55 · parseConflict", () => {
  test("đọc current, updated_at và updated_by", () => {
    const info = parseConflict(
      conflict({
        current: { version: 8, updated_by: "thu.ha", name: "a" },
        updated_at: "2026-10-01T10:42:00Z",
      }),
    );
    expect(info).toMatchObject({ updatedBy: "thu.ha", updatedAt: "2026-10-01T10:42:00Z" });
    expect(info?.current.version).toBe(8);
  });

  test("user/tenant không có updated_by → null", () => {
    const info = parseConflict(
      conflict({ current: { version: 2, updated_by: null }, updated_at: "t" }),
    );
    expect(info?.updatedBy).toBeNull();
    expect(
      parseConflict(conflict({ current: { version: 2 }, updated_at: "t" }))?.updatedBy,
    ).toBeNull();
  });

  test("details hỏng hoặc lỗi khác → null", () => {
    expect(parseConflict(conflict(undefined))).toBeNull();
    expect(parseConflict(conflict({ current: {}, updated_at: "t" }))).toBeNull();
    expect(parseConflict(conflict({ current: { version: 1 } }))).toBeNull();
    expect(parseConflict(new ApiError(409, "KEY_TAKEN", "x"))).toBeNull();
    expect(parseConflict(new Error("x"))).toBeNull();
  });
});

describe("ADM-FR-55 · pickKeys", () => {
  test("chỉ giữ khoá được chọn và có mặt", () => {
    expect(pickKeys({ a: 1, b: 2, c: 3 }, ["a", "c", "z"])).toEqual({ a: 1, c: 3 });
  });
});

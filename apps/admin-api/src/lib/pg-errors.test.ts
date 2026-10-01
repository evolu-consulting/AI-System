// ADM-NFR-01 · safeErrorFields không log SQL/tham số của Drizzle (review vòng 1 #9).
import { describe, expect, test } from "bun:test";
import { safeErrorFields, uniqueViolation } from "./pg-errors";

const wrapper = (cause?: unknown) =>
  Object.assign(new Error("Failed query: insert ... params: secret-hash"), {
    query: "insert ...",
    params: ["secret-hash"],
    cause,
  });

describe("ADM-NFR-01 · pg-errors", () => {
  test("ADM-NFR-01 · wrapper không có cause → chỉ 'query failed', không message/stack gốc", () => {
    const f = safeErrorFields(wrapper());
    expect(f).toEqual({ error: "query failed" });
    expect(JSON.stringify(f)).not.toContain("secret-hash");
  });

  test("ADM-NFR-01 · wrapper có cause Postgres → message + SQLSTATE của cause; 23505 đọc được tên constraint", () => {
    const cause = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "tenants_key_uq",
    });
    const f = safeErrorFields(wrapper(cause));
    expect([f.error, f.code]).toEqual(["duplicate key", "23505"]);
    expect(JSON.stringify(f)).not.toContain("secret-hash");
    expect(uniqueViolation(wrapper(cause))).toBe("tenants_key_uq");
  });

  test("ADM-NFR-01 · lỗi thường giữ message", () => {
    expect(safeErrorFields(new Error("boom")).error).toBe("boom");
  });
});

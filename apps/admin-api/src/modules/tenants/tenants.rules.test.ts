// ADM-FR-60 · changedTenantFields: chỉ trường gửi lên và khác giá trị hiện tại.
import { describe, expect, test } from "bun:test";
import { changedTenantFields } from "./tenants.rules";

const cur = { name: "Acme", maxConcurrentSub: 5 };

describe("ADM-FR-60 · changedTenantFields", () => {
  test("ADM-FR-60 · trùng giá trị hiện tại → rỗng (không tăng version)", () => {
    expect(changedTenantFields(cur, {})).toEqual({});
    expect(changedTenantFields(cur, { name: "Acme", max_concurrent_sub: 5 })).toEqual({});
  });

  test("ADM-FR-60 · đổi tên; null xoá giới hạn", () => {
    expect(changedTenantFields(cur, { name: "B", max_concurrent_sub: null })).toEqual({
      name: "B",
      maxConcurrentSub: null,
    });
  });
});

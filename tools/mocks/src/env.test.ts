import { describe, expect, test } from "bun:test";
import { loadMockEnv } from "./env";

describe("ADM-NFR-06 · loadMockEnv", () => {
  test("vắng hoặc rỗng → mặc định 4010/4020/30000", () => {
    const want = { difyPort: 4010, hubPort: 4020, timeoutMs: 30000 };
    expect(loadMockEnv({})).toEqual(want);
    expect(loadMockEnv({ DIFY_MOCK_PORT: "", MOCK_TIMEOUT_MS: "" })).toEqual(want);
  });

  test("đọc giá trị hợp lệ, MOCK_TIMEOUT_MS=0 được", () => {
    expect(
      loadMockEnv({ DIFY_MOCK_PORT: "5010", HUB_MOCK_PORT: "5020", MOCK_TIMEOUT_MS: "0" }),
    ).toEqual({ difyPort: 5010, hubPort: 5020, timeoutMs: 0 });
  });

  test.each([
    ["DIFY_MOCK_PORT", { DIFY_MOCK_PORT: "0" }],
    ["HUB_MOCK_PORT", { HUB_MOCK_PORT: "65536" }],
    ["HUB_MOCK_PORT", { HUB_MOCK_PORT: "abc" }],
    ["MOCK_TIMEOUT_MS", { MOCK_TIMEOUT_MS: "-1" }],
    ["MOCK_TIMEOUT_MS", { MOCK_TIMEOUT_MS: "1.5" }],
  ])("sai %s → lỗi nêu tên, không in giá trị", (name, source) => {
    expect(() => loadMockEnv(source)).toThrow(name);
    expect(() => loadMockEnv(source)).not.toThrow(Object.values(source)[0]);
  });
});

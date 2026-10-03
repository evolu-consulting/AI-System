import { describe, expect, test } from "bun:test";
import { loadMockEnv, MOCK_HUB_VERSION } from "./env";

const CHAT_DEFAULTS = {
  fast: false,
  flowIdleS: 600,
  eventsRetentionS: 600,
  healthVersion: MOCK_HUB_VERSION,
};

describe("ADM-NFR-06 · loadMockEnv", () => {
  test("vắng hoặc rỗng → mặc định 4010/4020/30000", () => {
    const want = { difyPort: 4010, hubPort: 4020, timeoutMs: 30000, ...CHAT_DEFAULTS };
    expect(loadMockEnv({})).toEqual(want);
    expect(loadMockEnv({ DIFY_MOCK_PORT: "", MOCK_TIMEOUT_MS: "", MOCK_FAST: "" })).toEqual(want);
  });

  test("đọc giá trị hợp lệ, MOCK_TIMEOUT_MS=0 được", () => {
    expect(
      loadMockEnv({ DIFY_MOCK_PORT: "5010", HUB_MOCK_PORT: "5020", MOCK_TIMEOUT_MS: "0" }),
    ).toEqual({ difyPort: 5010, hubPort: 5020, timeoutMs: 0, ...CHAT_DEFAULTS });
  });

  test("CHAT-AC-31 · MOCK_FAST, MOCK_FLOW_IDLE_S, MOCK_EVENTS_RETENTION_S; version /health là semver", () => {
    const env = loadMockEnv({
      MOCK_FAST: "1",
      MOCK_FLOW_IDLE_S: "0",
      MOCK_EVENTS_RETENTION_S: "2",
    });
    expect(env).toMatchObject({ fast: true, flowIdleS: 0, eventsRetentionS: 2 });
    expect(env.healthVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  test.each([
    ["DIFY_MOCK_PORT", { DIFY_MOCK_PORT: "0" }],
    ["HUB_MOCK_PORT", { HUB_MOCK_PORT: "65536" }],
    ["HUB_MOCK_PORT", { HUB_MOCK_PORT: "abc" }],
    ["MOCK_TIMEOUT_MS", { MOCK_TIMEOUT_MS: "-1" }],
    ["MOCK_TIMEOUT_MS", { MOCK_TIMEOUT_MS: "1.5" }],
    ["MOCK_FAST", { MOCK_FAST: "yes" }],
    ["MOCK_FLOW_IDLE_S", { MOCK_FLOW_IDLE_S: "-5" }],
    ["MOCK_EVENTS_RETENTION_S", { MOCK_EVENTS_RETENTION_S: "x9" }],
  ])("sai %s → lỗi nêu tên, không in giá trị", (name, source) => {
    expect(() => loadMockEnv(source)).toThrow(name);
    expect(() => loadMockEnv(source)).not.toThrow(Object.values(source)[0]);
  });
});

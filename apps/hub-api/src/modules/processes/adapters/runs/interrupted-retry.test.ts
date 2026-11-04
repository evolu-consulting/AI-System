// dlc-resume · stage bị gián đoạn (máy chủ khởi động lại): agent + tool gói không side_effect ⇒ thử lại; còn lại ⇒ quyết.
import { describe, expect, it } from "bun:test";
import type { PackToolCatalog } from "../../../packs/kit/application/pack-tools.ports";
import { isRetryableOnInterrupt } from "./interrupted.repo";

const catalog = (tools: Record<string, boolean>) =>
  ({
    info: (k: string) => (k in tools ? { key: k, sideEffect: tools[k] } : undefined),
  }) as unknown as PackToolCatalog;
const d = { packTools: catalog({ "dlc-step": false, "contracts-send": true }) };

describe("isRetryableOnInterrupt", () => {
  it("stage agent ⇒ thử lại", () => {
    expect(isRetryableOnInterrupt(d, { kind: "agent" })).toBe(true);
  });
  it("tool gói không side_effect ⇒ thử lại", () => {
    expect(isRetryableOnInterrupt(d, { kind: "tool", tool_key: "dlc-step" })).toBe(true);
  });
  it("tool gói side_effect / tool workflow lạ / không catalog ⇒ quyết", () => {
    expect(isRetryableOnInterrupt(d, { kind: "tool", tool_key: "contracts-send" })).toBe(false);
    expect(isRetryableOnInterrupt(d, { kind: "tool", tool_key: "dify-x" })).toBe(false);
    expect(isRetryableOnInterrupt({}, { kind: "tool", tool_key: "dlc-step" })).toBe(false);
    expect(isRetryableOnInterrupt(d, { kind: "team" })).toBe(false);
  });
});

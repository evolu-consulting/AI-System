// CR-114 hub-fast-sdk · luật chọn đường SDK trực tiếp.
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DIRECT_SDK_MODEL,
  type DirectSdkInput,
  directSdkModel,
  directSdkRoute,
} from "./direct-sdk.rules";

const base: DirectSdkInput = {
  runtime: "agentic-cli",
  runtimeOptions: { direct_sdk: true },
  sdkReady: true,
  fileCount: 0,
  sourceCount: 0,
  stage: false,
  autofix: false,
  workflowCount: 0,
  packToolCount: 0,
};

describe("CR-114 · direct-sdk eligibility", () => {
  it("eligible only when flag on and no CLI need", () => {
    expect(directSdkRoute(base)).toEqual({ ok: true });
  });
  it.each([
    [{ runtimeOptions: {} }, "flag_off"],
    [{ runtimeOptions: { direct_sdk: "true" } }, "flag_off"],
    [{ runtime: "dify-agent" }, "runtime"],
    [{ sdkReady: false }, "sdk_off"],
    [{ fileCount: 1 }, "files"],
    [{ sourceCount: 2 }, "sources"],
    [{ stage: true }, "stage"],
    [{ autofix: true }, "stage"],
    [{ workflowCount: 1 }, "tools"],
    [{ packToolCount: 1 }, "tools"],
  ] as const)("keeps job path: %o ⇒ %s", (patch, reason) => {
    expect(directSdkRoute({ ...base, ...patch })).toEqual({ ok: false, reason });
  });
  it("model precedence", () => {
    expect(directSdkModel({ model: "claude-haiku-5-5" }, "x", "y")).toBe("claude-haiku-5-5");
    expect(directSdkModel({}, "claude-sonnet-5-5", "y")).toBe("claude-sonnet-5-5");
    expect(directSdkModel({}, null, "env-model")).toBe("env-model");
    expect(directSdkModel({}, null, undefined)).toBe(DEFAULT_DIRECT_SDK_MODEL);
  });
});

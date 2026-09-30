import { describe, expect, test } from "bun:test";
import { isPlainObject, pickScenario } from "./scenario";

const tokens = { ok: "t-ok", unauthorized: "t-401", timeout: "t-to" };

describe("ADM-NFR-06 · pickScenario (T-MOCK-1)", () => {
  test.each([
    [{ header: "timeout", authorization: "Bearer t-ok" }, "timeout"],
    [{ header: "ok" }, "ok"],
    [{ header: "unauthorized", authorization: "Bearer t-ok" }, "unauthorized"],
    [{ header: "OK", authorization: "Bearer t-401" }, "unauthorized"],
    [{ header: "", authorization: "Bearer t-ok" }, "ok"],
    [{ header: "khac", authorization: "Bearer t-to" }, "timeout"],
    [{}, "unauthorized"],
    [{ authorization: "Basic YTpi" }, "unauthorized"],
    [{ authorization: "Bearer" }, "unauthorized"],
    [{ authorization: "Bearer " }, "unauthorized"],
    [{ authorization: "t-ok" }, "unauthorized"],
    [{ authorization: "bearer t-ok" }, "ok"],
    [{ authorization: "BEARER t-401" }, "unauthorized"],
    [{ authorization: "Bearer la-lam" }, "ok"],
  ] as const)("%j → %s", (input, want) => {
    expect(pickScenario({ ...input, tokens })).toBe(want);
  });
});

describe("ADM-NFR-06 · isPlainObject", () => {
  test.each([
    [{}, true],
    [{ a: 1 }, true],
    [null, false],
    [[], false],
    ["x", false],
    [1, false],
    [undefined, false],
  ])("%j → %p", (v, want) => {
    expect(isPlainObject(v)).toBe(want);
  });
});

// AC-H43 · HUB-FR-115 · PD-R24/R25 — `domain/defs/ttl.rules.ts` `ttlOnCreate`/`ttlOnUpdate`/`expiresAt`
// (plan-domain §4.8, plan §4.10). test-plan-rules PD-U72…U74.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "defs/ttl.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");

describe("ttl_days [PD-R24/R25]", () => {
  it("AC-H43 · PD-U72 · ttlOnCreate: undefined ⇒ 7 (mặc định); null ⇒ null (không hết hạn); 30 ⇒ 30", async () => {
    const f = await domainFn(REL, "ttlOnCreate");
    expect([f(undefined), f(null), f(30)]).toEqual([7, null, 30]);
  });
  it("AC-H43 · PD-U73 · ttlOnUpdate: (undefined, 30) ⇒ 30 giữ; (null, 30) ⇒ null; (10, null) ⇒ 10", async () => {
    const f = await domainFn(REL, "ttlOnUpdate");
    expect([f(undefined, 30), f(null, 30), f(10, null)]).toEqual([30, null, 10]);
  });
  it("AC-H43 · PD-U74 · expiresAt(N, 7) ⇒ N + 7 ngày; (N, null) ⇒ null", async () => {
    const f = await domainFn(REL, "expiresAt");
    expect(f(N, 7)).toEqual(new Date("2026-10-26T01:00:00.000Z"));
    expect(f(N, null)).toBeNull();
  });
});

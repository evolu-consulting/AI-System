// HUB-FR-101 · X2b2-R11, S6 · luật thuần `room-agent.rules.ts` `shouldBindRoomOutputs` (plan §8, test-plan X2b2 §2 U10).
// Module có sẵn (X2b) nhưng export mới vắng ⇒ đỏ ở `expect(typeof)`.
import { describe, expect, it } from "bun:test";
import { type Fn, loadRoomAgentRules } from "../_modules";

async function fn(name: string): Promise<Fn> {
  const m = await loadRoomAgentRules();
  expect(typeof m[name]).toBe("function");
  return m[name];
}

describe("X2b2-R11 · shouldBindRoomOutputs({status, reason}) [plan §8, D11]", () => {
  it("HUB-FR-101 · X2b2-AC10 · U10 · 4 status × 3 reason: true ⇔ finished ∧ posted", async () => {
    const bind = await fn("shouldBindRoomOutputs");
    const got: string[] = [];
    for (const status of ["running", "finished", "failed", "cancelled"])
      for (const reason of ["posted", "skipped", "already"])
        if (bind({ status, reason })) got.push(`${status}/${reason}`);
    expect(got).toEqual(["finished/posted"]);
  });
});

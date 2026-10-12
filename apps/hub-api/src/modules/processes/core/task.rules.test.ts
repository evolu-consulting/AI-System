// HUB-FR-106 · D9 · `decisionOptionsFor` dùng chung team-runner, sweeps, view (P-b2 T5b).
import { describe, expect, it } from "bun:test";
import { DECISION_OPTIONS } from "@ai/contracts/chat";
import { decisionOptionsFor } from "./task.rules";

describe("decisionOptionsFor [HUB-FR-106]", () => {
  it("có output ⇒ đủ lựa chọn", () => {
    expect(decisionOptionsFor(true, "interrupted")).toEqual([...DECISION_OPTIONS]);
  });
  it("không output, lý do thường ⇒ bỏ use_current", () => {
    expect(decisionOptionsFor(false, "interrupted")).not.toContain("use_current");
    expect(decisionOptionsFor(false, "template_invalid")).not.toContain("use_current");
  });
  it("không output, lý do nhóm / mất quyền ⇒ vẫn có use_current", () => {
    for (const r of ["team_calls", "permission_lost", "user_inactive"] as const)
      expect(decisionOptionsFor(false, r)).toContain("use_current");
  });
});

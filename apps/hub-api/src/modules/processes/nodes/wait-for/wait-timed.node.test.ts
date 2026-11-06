// CR-120 · G3/G4 · luật def + ép trường của node `wait_for` / `wait_event` (thuần).
import { describe, expect, it } from "bun:test";
import { nodeDefIssues, nodeSpecOf, normalizeStage } from "../registry";
import type { DefStage } from "../types";

const stage = (key: string, ex: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  ({
    key,
    name: key,
    instruction: "",
    executor: ex,
    output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
    after: { kind: "auto", branch: [] },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 60,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
    ...o,
  }) as unknown as DefStage;
const def = (stages: DefStage[]) => ({ stages, inputs: [] }) as never;

describe("CR-120 · wait_for / wait_event · defIssues", () => {
  it("def sạch ⇒ không lỗi", () => {
    const d = def([
      stage("w1", { kind: "wait_for", hours: 24 }),
      stage("w2", { kind: "wait_event", event: "esign.completed", timeout_h: 72 }),
    ]);
    expect(nodeDefIssues(d, {} as never)).toEqual([]);
  });

  it("after ≠ auto ⇒ WAIT_INVALID .after; real_action/sources ⇒ .executor", () => {
    const d = def([
      stage("w1", { kind: "wait_for", hours: 1 }, { after: { kind: "review", group_id: null } }),
      stage("w2", { kind: "wait_event", event: "a.b", timeout_h: 1 }, { real_action: true }),
    ]);
    expect(nodeDefIssues(d, {} as never)).toEqual([
      { path: "stages.0.after", rule: "WAIT_INVALID" },
      { path: "stages.1.executor", rule: "WAIT_INVALID" },
    ]);
  });

  it("hai wait_event cùng khoá ⇒ WAIT_INVALID ở stage sau", () => {
    const e = { kind: "wait_event", event: "x.done", timeout_h: 5 };
    const d = def([stage("a", e), stage("b", e)]);
    expect(nodeDefIssues(d, {} as never)).toEqual([
      { path: "stages.1.executor.event", rule: "WAIT_INVALID" },
    ]);
  });
});

describe("CR-120 · wait_for / wait_event · normalize", () => {
  it("ép template/mục Bàn giao, answerer starter, không field; idempotent", () => {
    for (const ex of [
      { kind: "wait_for", hours: 2 },
      { kind: "wait_event", event: "a.b", timeout_h: 2 },
    ]) {
      const n = normalizeStage(stage("w", ex, { token_budget: 5000 }));
      // CR-122 E3b · `wait_event` khai field `event` (khoá đã nhận / timeout); `wait_for` vẫn không field.
      const ev = ex.kind === "wait_event";
      expect(n.output.fields).toEqual(
        ev ? [{ key: "event", type: "string", required: false }] : [],
      );
      expect(n.output.required_sections).toEqual(["Bàn giao"]);
      expect(n.token_budget).toBeNull();
      expect(normalizeStage(n)).toEqual(n);
      expect(nodeSpecOf(ex.kind)?.produces).toBe(ev ? "declared" : "none");
    }
  });
});

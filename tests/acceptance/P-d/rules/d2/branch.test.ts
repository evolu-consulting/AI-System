// AC-H45 · AC-H44 · HUB-FR-147 · HUB-BR-38(e) · test-plan-d2 §1 PD2-U12…U17 (plan-d2-rules §1, D2-08, D-PD04): luật lớp 1 rẽ
// nhánh (`evaluateBranch`, `skippedStages`, `effectivePrevStep`) + trạng thái `skipped`/`tool_failed` ở luật cũ
// (`decisionOptionsFor`, `transition`, `stepJoin`, `runStatusOf`). Nạp qua CỔNG LỚP `loadLayer("domain", …)` (T17).
import { describe, expect, it } from "bun:test";
import { layerFn, loadLayer } from "../../_support/modules";

const dom = (name: string, task = "T19") => layerFn("domain", name, task);
const RULES = [
  { field: "tong_tien", op: "gt", value: 20_000_000, gotoStep: 3 },
  { field: "tong_tien", op: "eq", value: 0, gotoStep: 2 },
];

describe("PD2-U12 · evaluateBranch — luật đầu khớp [plan-d2-rules §1]", () => {
  it("AC-H45 · PD2-U12 · 25000000 ⇒ {3, luật 1}; 0 ⇒ {2, luật 2}; 1000 / null / trường vắng ⇒ null", async () => {
    const f = await dom("evaluateBranch");
    expect([
      f(RULES, { tong_tien: 25_000_000 }),
      f(RULES, { tong_tien: 0 }),
      f(RULES, { tong_tien: 1000 }),
      f(RULES, null),
      f(RULES, { khac: 1 }),
    ]).toEqual([{ gotoStep: 3, rule: 1 }, { gotoStep: 2, rule: 2 }, null, null, null]);
  });
  it("AC-H45 · PD2-U12 · date so YYYY-MM-DD: lt '2026-12-01' với '2026-11-20' ⇒ khớp (luật n)", async () => {
    const f = await dom("evaluateBranch");
    const r = [...RULES, { field: "han", op: "lt", value: "2026-12-01", gotoStep: 4 }];
    expect(f(r, { han: "2026-11-20" })).toEqual({ gotoStep: 4, rule: 3 });
  });
});

describe("PD2-U13…U14 · skippedStages + effectivePrevStep [D2-08]", () => {
  it("AC-H45 · PD2-U13 · steps [0,1,2,3] từ 1 tới 3 ⇒ [2]; tới 2 ⇒ []", async () => {
    const f = await dom("skippedStages");
    expect(f([0, 1, 2, 3], 1, 3)).toEqual([2]);
    expect(f([0, 1, 2, 3], 1, 2)).toEqual([]);
  });
  it("AC-H45 · PD2-U13 · bước song song: steps [0,1,2,2,3] từ 1 tới 3 ⇒ cả 2 stage của bước 2", async () => {
    expect((await dom("skippedStages"))([0, 1, 2, 2, 3], 1, 3)).toEqual([2, 3]);
  });
  it("AC-H45 · PD2-U14 · bước 2 toàn skipped, hỏi bước 3 ⇒ 1; bước 0 ⇒ null", async () => {
    const f = await dom("effectivePrevStep");
    const st = new Map<number, string[]>([
      [0, ["done"]],
      [1, ["done"]],
      [2, ["skipped"]],
      [3, ["running"]],
    ]);
    expect(f(st, 3)).toBe(1);
    expect(f(st, 0)).toBeNull();
  });
});

describe("PD2-U15…U17 · tool_failed / skipped ở luật cũ [D-PD04, plan-d2 §5]", () => {
  it("AC-H44 · PD2-U15 · decisionOptionsFor(false,tool_failed)=[add_attempt,cancel]; (true,…)=cả 3; FORCE_USE_CURRENT không chứa tool_failed", async () => {
    const f = await dom("decisionOptionsFor", "T17");
    expect(f(false, "tool_failed")).toEqual(["add_attempt", "cancel"]);
    expect(f(true, "tool_failed")).toEqual(["add_attempt", "use_current", "cancel"]);
    const force = await loadLayer("domain", "FORCE_USE_CURRENT", "T17");
    const has =
      force instanceof Set ? force.has("tool_failed") : (force as string[]).includes("tool_failed");
    expect(has).toBe(false);
  });
  it("AC-H44 · PD2-U16 · transition tool_failed + add_attempt ⇒ attempt+1 (như agent_failed)", async () => {
    const f = await dom("transition", "T17");
    const st = (reason: string) => ({
      status: "needs_decision",
      stageIdx: 0,
      stageCount: 2,
      stage: {
        status: "needs_decision",
        attempt: 1,
        attemptLimit: 4,
        asksCount: 0,
        askLimit: 3,
        after: "auto",
        hasOutput: false,
      },
      decisionReason: reason,
    });
    const add = { kind: "decide", option: "add_attempt" };
    const tool = f(st("tool_failed"), add);
    const agent = f(st("agent_failed"), add);
    expect(tool.ok).toBe(true);
    expect(tool.next.stage.attempt).toBe(2);
    expect(tool.next.stage).toEqual(agent.next.stage);
  });
  it("AC-H45 · PD2-U17 · stepJoin bước 2 {skipped, skipped} ⇒ không wait; runStatusOf toàn done/skipped ⇒ step_done (skipped = xong, RS-03)", async () => {
    const j = await dom("stepJoin", "T17");
    const statuses = new Map([
      [2, "skipped"],
      [3, "skipped"],
    ]);
    expect(j({ steps: [0, 1, 2, 2, 3], step: 2, statuses }).kind).not.toBe("wait");
    expect((await dom("runStatusOf", "T17"))(["done", "skipped", "done"])).toBe("step_done");
  });
});

// HUB-FR-105 · HUB-FR-107 · HUB-FR-109 · HUB-BR-28 · R-G01…R-G03, R-G05 — `realActionAllowed`, `reviewDecisionCheck`,
// `suggestProcesses` (gates/gate.rules.ts, plan-contract §7 "runs/start + gates (PF1)"; plan §9 PF1 `gates/gate.rules`).
// `suggestProcesses` có thể nằm ở `runs/start*.rules.ts` ⇒ gộp cả hai module (vắng ⇒ `{}` ⇒ đỏ ở expect).
import { describe, expect, it } from "bun:test";
import { fn, type Loose, loadProcRules } from "../../_support/modules";

async function G(name: string) {
  const mods: Loose[] = await Promise.all(
    ["gates/gate.rules.ts", "runs/start.rules.ts", "runs/runs.rules.ts"].map((p) =>
      loadProcRules(p),
    ),
  );
  const m = Object.assign({}, ...mods.reverse());
  return fn(m, name);
}

describe("R-G · luật cổng kiểm / gợi ý quy trình [HUB-FR-107, 109; HUB-BR-28]", () => {
  it("HUB-FR-109 · R-G01 · không có stage trước / stage trước auto done ⇒ false", async () => {
    const f = await G("realActionAllowed");
    expect(f(null)).toBe(false);
    expect(f({ after: "auto", status: "done" })).toBe(false);
  });
  it("HUB-FR-109 · R-G02 · stage trước review `done` ⇒ true; `waiting_review` ⇒ false", async () => {
    const f = await G("realActionAllowed");
    expect(f({ after: "review", status: "done" })).toBe(true);
    expect(f({ after: "review", status: "waiting_review" })).toBe(false);
  });
  it("HUB-FR-107 · R-G03 · pass ok; fail vắng / `   ` ⇒ FEEDBACK_REQUIRED; fail có góp ý ⇒ ok", async () => {
    const f = await G("reviewDecisionCheck");
    expect(f({ result: "pass" })).toBe("ok");
    expect(f({ result: "fail" })).toBe("FEEDBACK_REQUIRED");
    expect(f({ result: "fail", feedback: "   " })).toBe("FEEDBACK_REQUIRED");
    expect(f({ result: "fail", feedback: "Thiếu MST" })).toBe("ok");
  });
  it("HUB-BR-28 · R-G05 · `hoa-dn` ⇒ [hoa-don] (≤ 3); `zzz` ⇒ []", async () => {
    const f = await G("suggestProcesses");
    const keys = ["hoa-don", "sdlc", "p-auto", "p-team", "bao-cao"];
    const a = f("hoa-dn", keys);
    expect(a).toEqual(["hoa-don"]);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(f("zzz", keys)).toEqual([]);
  });
});

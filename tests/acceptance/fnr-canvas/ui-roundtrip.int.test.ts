// CR-103 · fnr-canvas: `stage.ui.y` (vị trí node canvas, chỉ-UI) lưu qua POST/PUT /process-defs và đọc lại nguyên vẹn;
// def cũ (không `ui`) vẫn lưu/đọc được; `ui` ngoài biên / khoá lạ ⇒ 422. Engine không đọc `ui` (chỉ lưu JSONB).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { agentStage, type CtxPd, createDef, defBody, type Json, startPd } from "../P-d/_support/pd";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const withUi = (key: string, step: number, ui?: Json): Json => ({
  ...agentStage({ key, step }),
  ...(ui ? { ui } : {}),
});
/** Body PUT = các trường input của def + `version`. */
function putBody(d: Json, stages: Json[]): Json {
  const { key, name, description, input_hint, run_group_ids, token_budget, enabled } = d;
  return {
    key,
    name,
    description,
    input_hint,
    run_group_ids,
    stages,
    token_budget,
    enabled,
    sources: d.sources ?? [],
    inputs: d.inputs ?? [],
    ttl_days: d.ttl_days,
    version: d.version,
  };
}

describe("fnr-canvas · ui.y round-trip", () => {
  it("POST có ui.y ⇒ GET trả đúng; PUT đổi/bỏ ui ⇒ GET phản ánh; stage không ui vẫn không có ui", async () => {
    const d = await createDef(
      c,
      defBody("fnr-ui-rt", [withUi("s0", 0, { y: 240.5 }), withUi("s1", 1)]),
    );
    const g1 = await c.call("Adm", "GET", `/process-defs/${d.id}`);
    expect(g1.status).toBe(200);
    expect(g1.json.stages[0].ui).toEqual({ y: 240.5 });
    expect("ui" in g1.json.stages[1]).toBe(false);

    const put = await c.call(
      "Adm",
      "PUT",
      `/process-defs/${d.id}`,
      putBody(g1.json, [withUi("s0", 0), withUi("s1", 1, { y: -30 })]),
    );
    expect(put.status).toBe(200);
    const g2 = await c.call("Adm", "GET", `/process-defs/${d.id}`);
    expect("ui" in g2.json.stages[0]).toBe(false);
    expect(g2.json.stages[1].ui).toEqual({ y: -30 });
  }, 60_000);

  it("ui ngoài biên hoặc khoá lạ ⇒ 4xx, không lưu", async () => {
    for (const ui of [{ y: 1e9 }, { y: 1, x: 2 }]) {
      const r = await c.call(
        "Adm",
        "POST",
        "/process-defs",
        defBody("fnr-ui-bad", [withUi("s0", 0, ui)]),
      );
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  }, 60_000);
});

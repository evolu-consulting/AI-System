// ADM-FR-65 · ADM-FR-66 · HUB-FR-104 · HUB-FR-109 · N1 · R-DF01…R-DF04 — `validateProcessDef`, `copyFromTemplate`
// (defs/def.rules.ts, plan-contract §6–§7). Thứ tự lỗi: INVALID → REF_INVALID (stage lỗi đầu) → INCOMPLETE.
import { describe, expect, it } from "bun:test";
import { fn, loadDefRules } from "../../_support/modules";

const AG1 = "a5a00000-0000-4000-8000-00000000d001";
const AG_BAD = "a5a00000-0000-4000-8000-00000000d0ff";
const TEAM1 = "a5a00000-0000-4000-8000-00000000d101";
const TEAM_BAD = "a5a00000-0000-4000-8000-00000000d1ff";
const G1 = "a5a00000-0000-4000-8000-00000000d201";
const G_BAD = "a5a00000-0000-4000-8000-00000000d2ff";
const U1 = "a5a00000-0000-4000-8000-00000000d301";
const U_BAD = "a5a00000-0000-4000-8000-00000000d3ff";
const refs = {
  agentIds: new Set([AG1]),
  teamIds: new Set([TEAM1]),
  groupIds: new Set([G1]),
  userIds: new Set([U1]),
};
// biome-ignore lint/suspicious/noExplicitAny: object thử theo contract ProcessStageDef
type J = any;
const stage = (o: J = {}): J => ({
  key: o.key ?? "s",
  name: o.name ?? "Giai đoạn",
  executor: o.executor ?? { kind: "agent", agent_id: AG1 },
  instruction: "",
  output: { filename: "out.md", template: "## A\n", required_sections: ["A"], fields: [] },
  after: o.after ?? { kind: "review", group_id: G1 },
  real_action: o.real_action ?? false,
  answerer: o.answerer ?? { kind: "starter" },
  timeout_s: 600,
  token_budget: null,
});
const def = (stages: J[], enabled = true): J => ({
  key: "p-thu",
  name: "Quy trình thử",
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages,
  token_budget: null,
  enabled,
});
const V = async () => fn(await loadDefRules(), "validateProcessDef");

describe("R-DF · kiểm định nghĩa quy trình [ADM-FR-65, 66]", () => {
  it("ADM-FR-65 · R-DF01 · key stage trùng; real_action ở stage 0; stage trước auto ⇒ PROCESS_DEF_INVALID + paths", async () => {
    const f = await V();
    const dup = f(def([stage({ key: "a" }), stage({ key: "a" })]), refs);
    expect(dup).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(dup.paths).toContain("stages.1.key");
    const ra0 = f(def([stage({ key: "a", real_action: true })]), refs);
    expect(ra0).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(ra0.paths).toContain("stages.0.real_action");
    const auto = f(
      def([stage({ key: "a", after: { kind: "auto" } }), stage({ key: "b", real_action: true })]),
      refs,
    );
    expect(auto).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(auto.paths).toContain("stages.1.real_action");
  });
  it("ADM-FR-65 · R-DF02 · agent lạ stage 2 + team lạ stage 3 ⇒ REF_INVALID stage lỗi đầu (agent); group lạ; user lạ", async () => {
    const f = await V();
    const s = [
      stage({ key: "a" }),
      stage({ key: "b" }),
      stage({ key: "c", executor: { kind: "agent", agent_id: AG_BAD } }),
      stage({ key: "d", executor: { kind: "team", team_id: TEAM_BAD } }),
    ];
    const r = f(def(s), refs);
    expect(r).toMatchObject({ ok: false, code: "PROCESS_REF_INVALID", ref: "agent" });
    expect(r.path.startsWith("stages.2")).toBe(true);
    const g = f(def([stage({ key: "a", after: { kind: "review", group_id: G_BAD } })]), refs);
    expect(g).toMatchObject({ ok: false, code: "PROCESS_REF_INVALID", ref: "group" });
    const u = f(def([stage({ key: "a", answerer: { kind: "user", user_id: U_BAD } })]), refs);
    expect(u).toMatchObject({ ok: false, code: "PROCESS_REF_INVALID", ref: "user" });
  });
  it("ADM-FR-66 · R-DF03 · bật + review thiếu group_id ⇒ INCOMPLETE; INVALID và INCOMPLETE cùng lúc ⇒ INVALID", async () => {
    const f = await V();
    const noGroup = (enabled: boolean) =>
      f(def([stage({ key: "a", after: { kind: "review", group_id: null } })], enabled), refs);
    expect(noGroup(true)).toEqual({
      ok: false,
      code: "PROCESS_DEF_INCOMPLETE",
      paths: ["stages.0.after.group_id"],
    });
    expect(noGroup(false)).toEqual({ ok: true });
    const both = f(
      def([stage({ key: "a", real_action: true, after: { kind: "review", group_id: null } })]),
      refs,
    );
    expect(both.code).toBe("PROCESS_DEF_INVALID");
  });
  it("ADM-FR-65 · R-DF04 · copyFromTemplate: group review = null, enabled=false; key/tên theo tham số; không đổi mẫu", async () => {
    const f = fn(await loadDefRules(), "copyFromTemplate");
    const t = def([stage({ key: "a" }), stage({ key: "b" })]);
    const c = f(t, {});
    expect(c.enabled).toBe(false);
    expect(c.key).toBe("p-thu");
    for (const s of c.stages) if (s.after.kind === "review") expect(s.after.group_id).toBeNull();
    const c2 = f(t, { key: "sdlc-2", name: "SDLC 2" });
    expect(c2).toMatchObject({ key: "sdlc-2", name: "SDLC 2", enabled: false });
    expect(t.stages[0].after.group_id).toBe(G1);
  });
});

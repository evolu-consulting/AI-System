// HUB-FR-79 · H3b-R12–R14, R05 · HUB-H3b-AC-07 · AC-A11 · test-plan-cases H3b §1.3 R20–R29: `effectiveAgents` — phạm vi
// (entitlement hoặc grant của T, loại Orchestrator), sắp key, `reasons`, `missing` thứ tự cố định, ma trận AC-07 144 dòng
// đối chiếu oracle viết tay + bất biến ≡ `visibleAgents` (R12).
import { describe, expect, it } from "bun:test";
import { AGENT_MISSING } from "@ai/contracts/hub-admin";
import {
  type EffectiveAgentCalc,
  effectiveAgents,
} from "../../../../apps/hub-api/src/modules/agent-grants/agent-effective.rules";
import {
  accessInput,
  visibleAgents,
} from "../../../../apps/hub-api/src/modules/agents/agent-access.rules";
import { AID, agent, deepFreeze, ent, GR, grant, idN, input, snap, TEN, USR } from "./_snap";

const keys = (r: EffectiveAgentCalc[]) => r.map((a) => a.key);
const byKey = (r: EffectiveAgentCalc[], k: string) => r.find((a) => a.key === k);
const reasonSet = (a: EffectiveAgentCalc | undefined) =>
  new Set((a?.reasons ?? []).map((x) => (x.code === "grant_user" ? "user" : `group:${x.groupId}`)));

describe("effectiveAgents — phạm vi, sắp, reasons [HUB-FR-79 · H3b-R12, R13]", () => {
  it("HUB-FR-79 · R20 · phạm vi: có hoadon (ent.), cu (ent. thu hồi + grant group); không khodu (chỉ beta), Orchestrator mặc định + tenant, chua [H3b-R13]", () => {
    const s = snap({
      agents: [
        agent(AID.hoadon, "hoadon"),
        agent(AID.cu, "cu"),
        agent(AID.khodu, "khodu"),
        agent(AID.orch, "orchestrator"),
        agent(AID.orchT, "orch-acme"),
        agent(AID.chua, "chua"),
      ],
      entitlements: [
        ent(AID.hoadon),
        ent(AID.cu, TEN.acme, true),
        ent(AID.khodu, TEN.beta),
        ent(AID.orch),
        ent(AID.orchT),
      ],
      grants: [
        grant(AID.cu, GR.g1),
        grant(AID.khodu, GR.g1, TEN.beta),
        grant(AID.orch, USR.lan),
        grant(AID.orchT, USR.lan),
      ],
      orch: AID.orch,
      orchTenants: [[TEN.acme, AID.orchT]],
    });
    expect(keys(effectiveAgents(input(s)))).toEqual(["cu", "hoadon"]);
  });

  it("HUB-FR-79 · R21 · 5 agent key lộn xộn ⇒ sắp theo key [H3b-R13]", () => {
    const ks = ["zeta", "alpha", "mid", "beta-x", "gamma"];
    const s = snap({
      agents: ks.map((k, i) => agent(idN(i), k)),
      entitlements: ks.map((_, i) => ent(idN(i))),
    });
    expect(keys(effectiveAgents(input(s)))).toEqual(["alpha", "beta-x", "gamma", "mid", "zeta"]);
  });

  it("HUB-FR-79 · R22 · reasons (như tập) = {grant_user, grant_group g1, g2}; không g3 (không thuộc), không grant beta cùng subject [H3b-R13 · G6]", () => {
    const s = snap({
      agents: [agent(AID.hoadon, "hoadon")],
      entitlements: [ent(AID.hoadon)],
      grants: [
        grant(AID.hoadon, USR.lan),
        grant(AID.hoadon, GR.g1),
        grant(AID.hoadon, GR.g2),
        grant(AID.hoadon, GR.g3),
        grant(AID.hoadon, USR.lan, TEN.beta),
      ],
    });
    const a = byKey(effectiveAgents(input(s)), "hoadon");
    expect(reasonSet(a)).toEqual(new Set(["user", `group:${GR.g1}`, `group:${GR.g2}`]));
    expect(a?.reasons.length).toBe(3);
  });

  it("HUB-FR-79 · R23 · mọi điều kiện xấu ⇒ missing đúng thứ tự AGENT_MISSING [H3b-R14]", () => {
    const s = snap({
      agents: [agent(AID.x, "x-bad", { enabled: false, runtime: "llm" })],
      entitlements: [ent(AID.x, TEN.acme, true)],
      grants: [grant(AID.x, GR.g3)],
    });
    const a = byKey(effectiveAgents(input(s, { active: false, locked: true })), "x-bad");
    expect(a?.missing).toEqual([
      "user_inactive",
      "tenant_locked",
      "agent_disabled",
      "runtime_unavailable",
      "no_entitlement",
      "no_grant",
    ]);
    expect(a?.missing).toEqual([...AGENT_MISSING]);
    expect(a?.visible).toBe(false);
  });
});

// ---------- ma trận AC-07 (R24–R26) ----------
type Grant = "user" | "group" | "none";
type Ten = "active" | "inactive" | "locked";
type Cell = {
  enabled: boolean;
  entActive: boolean;
  grant: Grant;
  runnable: boolean;
  userActive: boolean;
  tenant: Ten;
};
const CELLS: Cell[] = [];
for (const enabled of [true, false])
  for (const entActive of [true, false])
    for (const g of ["user", "group", "none"] as Grant[])
      for (const runnable of [true, false])
        for (const userActive of [true, false])
          for (const tenant of ["active", "inactive", "locked"] as Ten[])
            CELLS.push({ enabled, entActive, grant: g, runnable, userActive, tenant });

/** Oracle viết tay từ bảng R14 (spec §2): null = ngoài phạm vi (R13). */
function oracle(c: Cell): { visible: boolean; reasons: string[]; missing: string[] } | null {
  if (!c.entActive && c.grant === "none") return null;
  const missing: string[] = [];
  if (!c.userActive) missing.push("user_inactive");
  if (c.tenant !== "active") missing.push("tenant_locked");
  if (!c.enabled) missing.push("agent_disabled");
  if (!c.runnable) missing.push("runtime_unavailable");
  if (!c.entActive) missing.push("no_entitlement");
  if (c.grant === "none") missing.push("no_grant");
  const reasons = c.grant === "user" ? ["user"] : c.grant === "group" ? [`group:${GR.g1}`] : [];
  return { visible: missing.length === 0, reasons, missing };
}
function cellInput(c: Cell) {
  const s = snap({
    agents: [
      agent(AID.hoadon, "hoadon", {
        enabled: c.enabled,
        runtime: c.runnable ? "agentic-cli" : "llm",
      }),
    ],
    entitlements: [ent(AID.hoadon, TEN.acme, !c.entActive)],
    grants: c.grant === "none" ? [] : [grant(AID.hoadon, c.grant === "user" ? USR.lan : GR.g1)],
  });
  return input(s, {
    active: c.userActive,
    tenantActive: c.tenant !== "inactive",
    locked: c.tenant === "locked",
    groups: [GR.g1],
  });
}
function actual(c: Cell) {
  const a = byKey(effectiveAgents(cellInput(c)), "hoadon");
  return a ? { visible: a.visible, reasons: [...reasonSet(a)], missing: a.missing } : null;
}

describe("effectiveAgents — ma trận AC-07 [HUB-FR-79 · H3b-R12, R14 · HUB-H3b-AC-07]", () => {
  it("HUB-FR-79 · R24 · 144 dòng (agent × ent. × grant × runtime × user × tenant) khớp oracle viết tay [H3b-R14 · HUB-H3b-AC-07]", () => {
    expect(CELLS.length).toBe(144);
    const diff = CELLS.map((c) => ({ c, got: actual(c), want: oracle(c) })).filter(
      (x) => JSON.stringify(x.got) !== JSON.stringify(x.want),
    );
    expect(diff).toEqual([]);
  });

  it("HUB-FR-79 · R25 · 144 dòng: visible ⇔ missing.length = 0 [H3b-R14]", () => {
    for (const c of CELLS) {
      const a = byKey(effectiveAgents(cellInput(c)), "hoadon");
      if (a) expect({ c, ok: a.visible === (a.missing.length === 0) }).toEqual({ c, ok: true });
    }
  });

  it("HUB-FR-79 · R26 · user active ∧ tenant active: {visible} ≡ visibleAgents(accessInput(…)) (bất biến R12) [H3b-R12]", () => {
    const rows = CELLS.filter((c) => c.userActive && c.tenant === "active");
    expect(rows.length).toBe(24);
    for (const c of rows) {
      const i = cellInput(c);
      const got = effectiveAgents(i)
        .filter((a) => a.visible)
        .map((a) => a.agentId);
      const want = visibleAgents(
        accessInput(i.snapshot, {
          tenantId: i.tenantId,
          userId: i.user.id,
          groupIds: i.user.groupIds,
        }),
      ).map((x) => x.id);
      expect({ c, got }).toEqual({ c, got: want });
    }
  });
});

describe("effectiveAgents — AC-A11, R05, bất biến input [HUB-FR-79 · AC-A11 · H3b-R05]", () => {
  it("AC-A11 · R27 · ent. thu hồi + grant group ⇒ visible false, reasons [grant_group], missing [no_entitlement] [H3b-R14]", () => {
    const s = snap({
      agents: [agent(AID.cu, "cu")],
      entitlements: [ent(AID.cu, TEN.acme, true)],
      grants: [grant(AID.cu, GR.g1)],
    });
    expect(effectiveAgents(input(s, { groups: [GR.g1] }))).toEqual([
      {
        agentId: AID.cu,
        key: "cu",
        visible: false,
        reasons: [{ code: "grant_group", groupId: GR.g1 }],
        missing: ["no_entitlement"],
      },
    ]);
  });

  it("HUB-FR-79 · R28 · user inactive + grant ⇒ reasons vẫn grant_user; missing có user_inactive (grant không bị chặn) [H3b-R05]", () => {
    const s = snap({
      agents: [agent(AID.hoadon, "hoadon")],
      entitlements: [ent(AID.hoadon)],
      grants: [grant(AID.hoadon, USR.hoa)],
    });
    const a = byKey(
      effectiveAgents(input(s, { userId: USR.hoa, active: false, groups: [] })),
      "hoadon",
    );
    expect(a?.reasons).toEqual([{ code: "grant_user" }]);
    expect(a?.missing).toEqual(["user_inactive"]);
  });

  it("HUB-FR-79 · R29 · input đóng băng sâu ⇒ không ném, input không đổi [H3b-R12]", () => {
    const s = snap({
      agents: [agent(AID.hoadon, "hoadon"), agent(AID.cu, "cu")],
      entitlements: [ent(AID.hoadon), ent(AID.cu, TEN.acme, true)],
      grants: [grant(AID.hoadon, USR.lan), grant(AID.cu, GR.g1)],
    });
    const i = deepFreeze(input(s));
    const before = JSON.stringify(i);
    expect(() => effectiveAgents(i)).not.toThrow();
    expect(JSON.stringify(i)).toBe(before);
  });
});

// CR-105 L5 · unit: `approval_process` step of onboarding with a fake assign port (no DB, no hub).
import { describe, expect, test } from "bun:test";
import { parseSpec } from "../adapters/onboard.schema";
import type { OnboardSpec } from "../domain/onboard.rules";
import { APPROVAL_SLOT, onboardTenant } from "./onboard.usecase";
import type { AssignResult, OnboardPorts, OnboardRepo, ProcessAssignPort } from "./ports";

const repo: OnboardRepo = {
  actorOk: async () => true,
  lockTenant: async () => null,
  orgTakenBy: async () => null,
  insertTenant: async () => true,
  updateTenant: async () => {},
  upsertGroups: async () => ({ created: 1, renamed: 0 }),
  upsertDepartments: async () => 1,
  addMembers: async () => ({ added: 0, pending: [] }),
  setHeads: async () => 0,
};

function ports(assign?: ProcessAssignPort): OnboardPorts {
  return {
    write: (fn) => fn(repo, { changed: () => {}, audit: () => {} }),
    enablePack: async () => ({ groups: 3 }),
    newTenantSettings: {},
    fail: (code) => new Error(code),
    ...(assign ? { processAssign: assign } : {}),
  };
}

const spec = (extra: Partial<OnboardSpec> = {}): OnboardSpec => ({
  key: "acme",
  name: "Acme",
  timezone: "Asia/Ho_Chi_Minh",
  profile: {},
  packs: ["contracts"],
  root: { key: "root", vi: "Goc", members: [] },
  departments: [],
  ...extra,
});

const fake = (r: AssignResult | Error) => {
  const calls: [string, string, string][] = [];
  const port: ProcessAssignPort = {
    assign: async (t, s, k) => {
      calls.push([t, s, k]);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { port, calls };
};

describe("onboard approval_process", () => {
  test("absent => no call, approval null", async () => {
    const f = fake({ ok: true });
    const r = await onboardTenant(ports(f.port), spec(), "actor");
    expect(r.approval).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  test("valid key => assigns slot contracts.approval to the new tenant", async () => {
    const f = fake({ ok: true });
    const r = await onboardTenant(ports(f.port), spec({ approval_process: "sales-flow" }), "a");
    expect(r.approval).toEqual({ process: "sales-flow", slot: APPROVAL_SLOT, state: "assigned" });
    expect(f.calls).toEqual([[r.tenant.id, "contracts.approval", "sales-flow"]]);
  });

  test("port rejects (not published / groups missing) => step error, tenant still created", async () => {
    const f = fake({ ok: false, code: "PROCESS_NOT_PUBLISHED" });
    const r = await onboardTenant(ports(f.port), spec({ approval_process: "x-flow" }), "a");
    expect(r.tenant.created).toBe(true);
    expect(r.approval?.state).toBe("error");
    expect(r.approval?.error).toBe("PROCESS_NOT_PUBLISHED");
  });

  test("port throws => ASSIGN_FAILED, tenant still created", async () => {
    const f = fake(new Error("boom"));
    const r = await onboardTenant(ports(f.port), spec({ approval_process: "x-flow" }), "a");
    expect(r.tenant.created).toBe(true);
    expect(r.approval?.error).toBe("ASSIGN_FAILED");
  });

  test("no port configured => ASSIGN_NOT_CONFIGURED; contracts pack missing => error", async () => {
    const a = await onboardTenant(ports(), spec({ approval_process: "x-flow" }), "a");
    expect(a.approval?.error).toBe("ASSIGN_NOT_CONFIGURED");
    const f = fake({ ok: true });
    const b = await onboardTenant(ports(f.port), spec({ packs: [], approval_process: "k1" }), "a");
    expect(b.approval?.error).toBe("PACK_CONTRACTS_NOT_ENABLED");
    expect(f.calls).toHaveLength(0);
  });

  test("yaml parsing: optional field, invalid key rejected", () => {
    const base = "key: acme\nname: Acme\nroot: { key: root, vi: Goc }\npacks: [contracts]\n";
    const ok = parseSpec(`${base}approval_process: sales-flow\n`);
    expect(ok.ok && ok.spec.approval_process).toBe("sales-flow");
    const none = parseSpec(base);
    expect(none.ok && none.spec.approval_process).toBeUndefined();
    expect(parseSpec(`${base}approval_process: "Bad Key!"\n`).ok).toBe(false);
  });
});

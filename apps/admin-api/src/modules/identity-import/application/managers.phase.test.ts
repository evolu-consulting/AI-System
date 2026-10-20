// M1D-FR-02 · docs/specs/M1c-fixes (review A-13): `manager_email` phải là email hợp lệ — khoá nội bộ `#<uuid>` không nhắm được.
import { describe, expect, it } from "bun:test";
import type { ImportReport } from "../domain/import";
import { managerPhase } from "./managers.phase";
import type { ImportStore, TenantUser } from "./ports";

const report = (): ImportReport => ({
  dry_run: false,
  orgs: { read: 0, created: 0, existing: 0, errors: 0 },
  users: { read: 0, created: 0, existing: 0, errors: 0, hash_imported: 0, reset_required: 0 },
  managers: { read: 0, set: 0, existing: 0, errors: 0 },
  issues: [],
  accounts: [],
  batches: 0,
  ms: 0,
});

describe("M1D-FR-02 · managerPhase lọc email", () => {
  it("manager_email '#<uuid>' ⇒ MANAGER_UNKNOWN, không đặt; email hợp lệ ⇒ đặt", async () => {
    const rows: TenantUser[] = [
      { tenantId: "t", id: "1", email: "a@x.test", username: "a", managerId: null },
      { tenantId: "t", id: "2", email: "b@x.test", username: "b", managerId: null },
      { tenantId: "t", id: "3", email: null, username: "c", managerId: null },
    ];
    const store = {
      managerBatch: async (
        _a: boolean,
        _t: string[],
        decide: (u: TenantUser[]) => { sets: [] },
      ) => {
        const plan = decide(rows);
        return { plan, written: plan.sets.length };
      },
    } as unknown as ImportStore;
    const r = { report: report(), tenantOf: new Map([["o", "t"]]), keyOf: new Map([["t", "k"]]) };
    await managerPhase(
      r,
      [
        { email: "a@x.test", orgId: "o", managerEmail: "#3" },
        { email: "b@x.test", orgId: "o", managerEmail: "a@x.test" },
      ],
      { apply: true, batch: 10 },
      { store, constraintError: () => null },
    );
    expect({ m: r.report.managers, issues: r.report.issues }).toEqual({
      m: { read: 2, set: 1, existing: 0, errors: 1 },
      issues: [{ kind: "manager", ref: "a@x.test", code: "MANAGER_UNKNOWN" }],
    });
  });
});

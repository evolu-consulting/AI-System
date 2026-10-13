// HUB-FR-78 · hàm thuần ma trận Quyền agent.
import { describe, expect, test } from "bun:test";
import type { EntitlementMatrix } from "@ai/contracts/studio";
import {
  cellKey,
  filterMatrix,
  grantedCell,
  indexCells,
  isNotApplicable,
  withCell,
} from "./matrix";

const A1 = "a1";
const A2 = "a2";
const T1 = "t1";
const T2 = "t2";
const agent = (id: string, only: string | null = null) => ({
  id,
  key: id,
  name: id,
  enabled: true,
  is_orchestrator: only !== null,
  only_tenant_id: only,
});
const tenant = (id: string) => ({ id, key: id, name: id, active: true });
const [ag1, ag2] = [agent(A1), agent(A2, T2)];
const [tn1, tn2] = [tenant(T1), tenant(T2)];
const m: EntitlementMatrix = {
  agents: [ag1, ag2],
  tenants: [tn1, tn2],
  cells: [grantedCell({ agentId: A1, tenantId: T1 }, 2, "2026-10-01T00:00:00.000Z")],
  truncated: false,
  hub_config_version: 1,
};

describe("HUB-FR-78 · ma trận Quyền agent", () => {
  test("indexCells tra theo agent|tenant", () => {
    const idx = indexCells(m.cells);
    expect(idx.get(cellKey(A1, T1))?.grant_count).toBe(2);
    expect(idx.has(cellKey(A1, T2))).toBe(false);
  });
  test("filterMatrix: rỗng = tất cả; id lạ = tất cả; id đúng = một dòng/cột", () => {
    expect(filterMatrix(m, "", "").agents).toHaveLength(2);
    expect(filterMatrix(m, A1, "").agents.map((a) => a.id)).toEqual([A1]);
    expect(filterMatrix(m, "", T2).tenants.map((t) => t.id)).toEqual([T2]);
    expect(filterMatrix(m, "zz", "").agents).toHaveLength(2);
  });
  test("isNotApplicable: only_tenant_id khác cột ⇒ true", () => {
    expect(isNotApplicable(ag2, tn1)).toBe(true);
    expect(isNotApplicable(ag2, tn2)).toBe(false);
    expect(isNotApplicable(ag1, tn2)).toBe(false);
  });
  test("withCell thêm/gỡ không đổi bản cũ", () => {
    const ref = { agentId: A1, tenantId: T1 };
    const off = withCell(m, ref, null);
    expect(off.cells).toHaveLength(0);
    expect(m.cells).toHaveLength(1);
    const on = withCell(
      off,
      { agentId: A2, tenantId: T2 },
      grantedCell({ agentId: A2, tenantId: T2 }, 0, "x"),
    );
    expect(on.cells.map((c) => c.agent_id)).toEqual([A2]);
  });
});

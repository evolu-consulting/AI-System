// ADM-FR-73 · TT-R03 (plan-d2 §6, §8) · lớp 2: liệt kê + bật/tắt công tắc tool theo tenant.
// Bật/tắt: khoá hàng (một câu, kèm kiểm tenant/workflow) ⇒ `toggleChange` ⇒ ghi ≤ 1 câu ⇒ audit + config_changed
// CHỈ khi đổi. Không vòng hàng (Luật 4c).
import { isOnAfter, type ToggleWant, toggleChange } from "../domain";
import {
  type SwitchKey,
  type SwitchRow,
  ToolNotFoundError,
  type ToolsTx,
  type ToolTarget,
  type ToolView,
  type WorkflowToolsRepo,
} from "./ports";

export const TOOLS_LIST_LIMIT = 200;

export function listTools(tx: ToolsTx, tenantId: string): Promise<ToolView[]> {
  return tx.read(async (r) => {
    if (!(await r.tenantExists(tenantId))) throw new ToolNotFoundError();
    return r.list(tenantId, TOOLS_LIST_LIMIT);
  });
}

function view(t: ToolTarget, row: SwitchRow | null, on: boolean): ToolView {
  return {
    workflowId: t.workflowId,
    key: t.key,
    name: t.name,
    sideEffect: t.sideEffect,
    enabled: t.enabled,
    on,
    grantedAt: on && row ? row.grantedAt : null,
    grantedBy: on && row ? row.grantedBy : null,
  };
}

async function unchanged(r: WorkflowToolsRepo, k: SwitchKey): Promise<ToolView> {
  const t = await r.lockOne(k);
  if (!t) throw new ToolNotFoundError();
  return view(t, t.cur, isOnAfter(t.cur, "none"));
}

function write(
  r: WorkflowToolsRepo,
  t: ToolTarget,
  { k, actorId, want }: { k: SwitchKey; actorId: string; want: ToggleWant },
) {
  const change = toggleChange(t.cur, want);
  if (change === "insert") return { change, row: r.insert(k, actorId) };
  if (change === "reactivate") return { change, row: r.reactivate(k, actorId) };
  if (change === "revoke") return { change, row: r.revoke(k) };
  return { change, row: Promise.resolve(null) };
}

/** PUT (`on`) / DELETE (`off`). Đã đúng trạng thái ⇒ 200 không đổi, 0 audit, 0 NOTIFY. */
export function toggleTool(
  tx: ToolsTx,
  k: SwitchKey,
  actorId: string,
  want: ToggleWant,
): Promise<ToolView> {
  return tx.write(async (r, sink) => {
    const t = await r.lockOne(k);
    if (!t) throw new ToolNotFoundError();
    const w = write(r, t, { k, actorId, want });
    const row = await w.row;
    if (w.change === "none") return view(t, t.cur, isOnAfter(t.cur, "none"));
    if (!row) return unchanged(r, k); // đua INSERT: hàng do giao dịch khác vừa ghi ⇒ đọc lại, không audit
    sink.changed(k.tenantId);
    sink.audit({
      action: want === "on" ? "grant" : "revoke",
      tenantId: k.tenantId,
      workflowId: t.workflowId,
      key: t.key,
    });
    return view(t, row, isOnAfter(t.cur, w.change));
  });
}

// HUB-FR-77 · HUB-FR-78 · D9/D10: cấp/thu hồi entitlement, cập nhật lạc quan. Lỗi `AGENT_IS_DEFAULT` ⇒ hoàn ô + toast riêng,
// không tải lại; lỗi khác (VERSION_CONFLICT, 404, 5xx…) ⇒ hoàn ô + toast `access.errors.conflict` + tải lại ma trận.
// Thành công ⇒ toast + invalidate ma trận và `me` (ConfigBadge vN).
import type { EntitlementMatrix } from "@ai/contracts/studio";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { meQuery } from "#/features/shell/api";
import { ACCESS_KEY, grantEntitlement, matrixQuery, revokeEntitlement } from "../api";
import { cellKey, grantedCell, indexCells, type Ref, withCell } from "../lib/matrix";

export type CellTarget = Ref & { agentKey: string; tenantKey: string };

const apiCode = (e: unknown) => (e as { code?: unknown } | null)?.code;
type Ctx = { qc: QueryClient; t: ReturnType<typeof useTranslation>["t"] };

const read = (qc: QueryClient) => qc.getQueryData<EntitlementMatrix>(matrixQuery.queryKey);

/** Đặt lại ô `c` về trạng thái trong `prev` (hoàn cập nhật lạc quan) rồi báo lỗi theo mã. */
function fail({ qc, t }: Ctx, err: unknown, c: CellTarget, prev?: EntitlementMatrix) {
  const cur = read(qc);
  const old = prev ? indexCells(prev.cells).get(cellKey(c.agentId, c.tenantId)) : undefined;
  if (cur) qc.setQueryData(matrixQuery.queryKey, withCell(cur, c, old ?? null));
  if (apiCode(err) === "AGENT_IS_DEFAULT") {
    toast.error(t("access.errors.isDefault"));
    return;
  }
  toast.error(t("access.errors.conflict"));
  void qc.invalidateQueries({ queryKey: ACCESS_KEY });
}

/** Cấp (`on=true`, PUT) hoặc thu hồi (`on=false`, DELETE) một ô, lạc quan. */
async function change(ctx: Ctx, c: CellTarget, on: boolean) {
  const { qc, t } = ctx;
  await qc.cancelQueries({ queryKey: matrixQuery.queryKey, exact: true });
  const prev = read(qc);
  const next = on ? grantedCell(c, 0, new Date().toISOString()) : null;
  if (prev) qc.setQueryData(matrixQuery.queryKey, withCell(prev, c, next));
  const ref = { agentId: c.agentId, tenantId: c.tenantId };
  try {
    await (on ? grantEntitlement(ref) : revokeEntitlement(ref));
    const names = { agent: c.agentKey, tenant: c.tenantKey };
    toast.success(t(on ? "access.toast.granted" : "access.toast.revoked", names));
    for (const queryKey of [ACCESS_KEY, meQuery.queryKey]) void qc.invalidateQueries({ queryKey });
  } catch (err) {
    fail(ctx, err, c, prev);
  }
}

/** `grant`/`revoke` ổn định (giữ memo của ô ma trận). */
export function useAccessMutations() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMemo(
    () => ({
      grant: (c: CellTarget) => change({ qc, t }, c, true),
      revoke: (c: CellTarget) => change({ qc, t }, c, false),
    }),
    [qc, t],
  );
}

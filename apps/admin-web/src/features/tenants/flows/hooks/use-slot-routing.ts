// CR-118 §11.2 · hành động gán/bỏ gán quy trình (platform_admin) + lưu luật của một tenant × khe. Lỗi ⇒ `RoutingErrorSpec` cho UI.
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import {
  type RoutingErrorSpec,
  type RuleDraft,
  routingErrorOf,
  toPutBody,
} from "@ai/web-kit/routing-rules";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assignRoutingProcess, putRouting, RKEYS, unassignRoutingProcess } from "../../api-routing";

type Done = { ok: true } | { ok: false; spec: RoutingErrorSpec; raw: unknown };

export function useSlotRoutingActions(tenantId: string, slot: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const key = RKEYS.routing(tenantId, slot);
  const run = async (job: () => Promise<unknown>): Promise<Done> => {
    setPending(true);
    try {
      await job();
      // Một nguồn = luật định tuyến của công ty: sau mọi lần ghi làm tươi luật mọi việc, năng lực (tóm tắt), thân quy trình, bản thư viện/lượt chạy.
      await qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["process", "routing", tenantId] });
      void qc.invalidateQueries({ queryKey: ["process", "assigned", "caps", tenantId] });
      void qc.invalidateQueries({ queryKey: ["process", "company-lib", tenantId] });
      void qc.invalidateQueries({ queryKey: ["process", "company-runs", tenantId] });
      void qc.invalidateQueries({ queryKey: ["process", "tenant-slots"] });
      return { ok: true };
    } catch (e) {
      return { ok: false, spec: routingErrorOf(e), raw: e };
    } finally {
      setPending(false);
    }
  };
  return {
    pending,
    assign: (defId: string) => run(() => assignRoutingProcess(tenantId, slot, defId)),
    unassign: (defId: string) => run(() => unassignRoutingProcess(tenantId, slot, defId)),
    save: async (version: number, rules: readonly RuleDraft[]): Promise<Done> => {
      setPending(true);
      try {
        const data: ProcessRouting = await putRouting(tenantId, slot, toPutBody(version, rules));
        qc.setQueryData(key, data);
        void qc.invalidateQueries({ queryKey: ["process", "assigned", "caps", tenantId] });
        return { ok: true };
      } catch (e) {
        return { ok: false, spec: routingErrorOf(e), raw: e };
      } finally {
        setPending(false);
      }
    },
  };
}

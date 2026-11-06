// CR-121 c11 · Gán/Đổi quy trình cho một việc và Sao chép cho công ty (tự gán thay bản cũ, Q9).
// platform_admin: gán vào tập + đặt mặc định (một đường Hub). tenant_admin: đổi MẶC ĐỊNH trong tập quy trình công ty đã có (PUT luật).
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { toPutBody } from "@ai/web-kit/routing-rules";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { processErrorSpec } from "@/features/processes/lib/errors";
import { useTr } from "@/lib/use-translate";
import { assignRoutingProcess, putRouting, RKEYS } from "../../api-routing";
import { cloneForCompany } from "../api";
import { assignErrorOf } from "../lib/assign-error";
import { withDefault } from "../lib/flow-rows";

export function useFlowAssign(tenantId: string, slot: string, isPlatform: boolean) {
  const tr = useTr();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: RKEYS.routing(tenantId, slot) });
    void qc.invalidateQueries({ queryKey: ["process", "assigned", "caps", tenantId] });
    void qc.invalidateQueries({ queryKey: ["process", "company-lib", tenantId] });
  };
  const run = async (job: () => Promise<unknown>, done: string): Promise<boolean> => {
    setPending(true);
    try {
      await job();
      await refresh();
      notifySuccess(tr(done));
      return true;
    } catch (e) {
      // f6: lỗi gán có câu nghiệp vụ + cách khắc phục; còn lại c17: NOT_LIBRARY_DEF / SLOT_GONE có câu riêng.
      const app = slot.split(".")[0] ?? "";
      const mine = assignErrorOf(e, { app: tr(`featmeta.app.${app}.name`) });
      if (mine)
        notifyError(`${tr(mine.key, mine.params)} ${tr(`tenants.flows.err.go.${mine.action}`)}`);
      else {
        const spec = processErrorSpec(e);
        notifyError(tr(spec.key, spec.params));
      }
      return false;
    } finally {
      setPending(false);
    }
  };
  return {
    pending,
    /** Dùng `defId` làm quy trình của việc. tenant_admin cần `routing` (đọc mới nhất) để giữ luật điều kiện. */
    use: (defId: string, routing: ProcessRouting | undefined) =>
      run(
        () =>
          isPlatform || !routing
            ? assignRoutingProcess(tenantId, slot, defId)
            : putRouting(tenantId, slot, toPutBody(routing.version, withDefault(routing, defId))),
        "tenants.flows.toast.assigned",
      ),
    copy: (defId: string) =>
      run(() => cloneForCompany(tenantId, defId), "tenants.flows.toast.copied"),
  };
}

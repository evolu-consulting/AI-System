// ADM-FR-40 · M4-AC02 · Q9 · lưu quota cả bộ kèm `version` tenant; 409 → ConflictDialog (entity tenant), `Ghi đè` gửi lại cùng bộ.
import type { QuotaItemInput, QuotaSetResponse } from "@ai/contracts";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import type { ConflictCurrent } from "@/lib/conflict";
import { useSetTenantQuotas } from "../api";

type Handlers = {
  onSaved: (res: QuotaSetResponse) => void;
  onFail: (err: unknown) => void;
  onReload: (current: ConflictCurrent) => void;
};

export function useTenantQuotaSave(tenantId: string, h: Handlers) {
  const set = useSetTenantQuotas(tenantId);
  const conflict = useConflictSave<{ items: QuotaItemInput[] }, QuotaSetResponse>({
    entity: "tenant",
    mutate: (body) => set.mutateAsync(body),
    // Bản tenant mới không chứa quota → diff liệt kê toàn bộ bộ của bạn (mine) so với rỗng.
    toComparable: () => ({}),
    ...h,
  });
  return { ...conflict, pending: set.isPending };
}

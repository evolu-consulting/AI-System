// ADM-FR-55 · M3-R20 · PATCH tenant kèm version, 409 → ConflictDialog (tenant không có updated_by → câu không {user}, A4).
import type { TenantUpdateRequest } from "@ai/contracts";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import type { ConflictCurrent } from "@/lib/conflict";
import { useUpdateTenant } from "../api";

type Handlers = {
  onSaved: () => void;
  onFail: (err: unknown) => void;
  onReload: (current: ConflictCurrent) => void;
};

export function useTenantConflict(tenantId: string, h: Handlers) {
  const update = useUpdateTenant(tenantId);
  const conflict = useConflictSave<Omit<TenantUpdateRequest, "version">>({
    entity: "tenant",
    mutate: (body) => update.mutateAsync(body as TenantUpdateRequest),
    ...h,
  });
  return { ...conflict, pending: update.isPending };
}

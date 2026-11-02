// CR-111 · tab "Feature" của công ty: nạp trạng thái cấp, giữ bản nháp (tập key mong muốn), lưu một lượt bằng diff.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useApplyTenantEntitlements } from "@/features/features/api";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useTenantFeatureStates } from "../api";
import { buildCards, diffEntitlements, entitledKeys } from "../lib/feature-assign";

export function useTenantFeatures(
  tenant: { id: string; name: string },
  onDirtyChange: (d: boolean) => void,
) {
  const { t } = useTranslation();
  const tr = useTr();
  const query = useTenantFeatureStates(tenant.id, true);
  const apply = useApplyTenantEntitlements(tenant.id);
  const features = query.data;
  const current = useMemo(() => entitledKeys(features ?? []), [features]);
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const value = draft ?? current;
  const cards = useMemo(() => buildCards(features ?? []), [features]);
  const diff = useMemo(() => diffEntitlements(features ?? [], value), [features, value]);
  const dirty = diff.grant.length + diff.revoke.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const save = useCallback(async () => {
    try {
      await apply.mutateAsync({
        grant: diff.grant.map((f) => f.id),
        revoke: diff.revoke.map((f) => f.id),
      });
      setDraft(null);
      notifySuccess(t("tenants.features.toast.saved", { tenant: tenant.name }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params)); // một toast; phần đã ghi được hiện qua lần nạp lại, diff còn lại giữ nguyên để lưu tiếp
    }
  }, [apply, diff, t, tr, tenant.name]);

  return {
    query,
    cards,
    value,
    diff,
    dirty,
    saving: apply.isPending,
    change: (next: ReadonlySet<string>) => setDraft(next),
    reset: () => setDraft(null),
    save,
  };
}

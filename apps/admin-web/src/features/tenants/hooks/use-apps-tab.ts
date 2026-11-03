// CR-112 · ADM-FR-78 · tab "Ứng dụng & Gói": nạp trạng thái cấp + gói + vai, giữ bản nháp (tập key + ý định gói), lưu một lượt
// theo kế hoạch (bật gói → entitlement → tắt gói). Lỗi từng phần: toast nêu phần đã lưu, bản nháp giữ nguyên để lưu tiếp.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useApplyTenantEntitlements } from "@/features/features/api";
import { useOrgList } from "@/features/partners/api";
import { useSession } from "@/lib/auth/use-session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useSetTenantPack, useTenantFeatureStates, useTenantPacks } from "../api";
import { useTenantAppRoles } from "../api-apps";
import {
  derivePacks,
  nextIntent,
  type PackIntent,
  PlanError,
  planChanges,
  planSize,
  runPlan,
} from "../lib/apps-plan";
import {
  type AppCard,
  type AppLevel,
  buildCards,
  detectLevel,
  entitledKeys,
  setLevel,
} from "../lib/feature-assign";

/** Thông báo lỗi lưu: lỗi đầu tiên + số bước đã áp dụng (lỗi từng phần); phiên hết hạn ⇒ null (đã chuyển trang đăng nhập). */
function failureText(
  err: unknown,
  t: (k: string, p?: Record<string, unknown>) => string,
  tr: ReturnType<typeof useTr>,
): string | null {
  const reason = err instanceof PlanError ? err.reason : err;
  if (reason instanceof ApiError && reason.code === "UNAUTHORIZED") return null;
  const spec = describeError(reason);
  const msg = tr(spec.key, spec.params);
  const done = err instanceof PlanError ? err.done.length : 0;
  return done > 0 ? `${msg} ${t("tenants.apps.partial", { done })}` : msg;
}

export function useAppsTab(
  tenant: { id: string; name: string },
  onDirtyChange: (d: boolean) => void,
) {
  const { t } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const query = useTenantFeatureStates(tenant.id, true);
  // GET packs chỉ cho platform_admin (tenant_admin ⇒ 403): tenant_admin suy trạng thái gói từ entitlement + vai.
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const packsQ = useTenantPacks(tenant.id, isPlatform);
  const rolesQ = useTenantAppRoles(tenant.id, true);
  const apply = useApplyTenantEntitlements(tenant.id);
  const setPack = useSetTenantPack(tenant.id);
  const features = query.data;
  const cards = useMemo(() => buildCards(features ?? []), [features]);
  const packs = useMemo(
    () => (isPlatform ? (packsQ.data?.items ?? []) : derivePacks(cards, rolesQ.data?.items ?? [])),
    [isPlatform, packsQ.data, cards, rolesQ.data],
  );
  const current = useMemo(() => entitledKeys(features ?? []), [features]);
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const [intent, setIntent] = useState<PackIntent>({});
  const [saving, setSaving] = useState(false);
  const value = draft ?? current;
  const hasCommunity = cards.some((c) => c.app === "community" && c.mode === "levels");
  const partnersQ = useOrgList({ tenantId: tenant.id, q: "", offset: 0 }, hasCommunity);
  const plan = useMemo(
    () => planChanges(features ?? [], cards, packs, value, intent),
    [features, cards, packs, value, intent],
  );
  const dirty = planSize(plan) > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const changeLevel = useCallback(
    (card: AppCard, level: AppLevel) => {
      setDraft(setLevel(value, card, level));
      setIntent((i) => nextIntent(i, card.app, level, detectLevel(card, current).level));
    },
    [value, current],
  );

  const reset = useCallback(() => {
    setDraft(null);
    setIntent({});
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await runPlan(plan, {
        setPack: (key, on, level) => setPack.mutateAsync({ key, on, level }),
        apply: (grant, revoke) => apply.mutateAsync({ grant, revoke }),
      });
      reset();
      notifySuccess(t("tenants.features.toast.saved", { tenant: tenant.name }));
    } catch (err) {
      const text = failureText(err, t, tr);
      if (text) notifyError(text);
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: ["tenants", "app-roles", tenant.id] });
    }
  }, [plan, setPack, apply, reset, t, tr, tenant.name, tenant.id, qc]);

  return {
    query,
    packsQ,
    cards,
    packs,
    roles: rolesQ.data?.items ?? [],
    partners: partnersQ.data?.total ?? 0,
    value,
    plan,
    dirty,
    saving,
    changeLevel,
    change: (next: ReadonlySet<string>) => setDraft(next),
    reset,
    save,
  };
}

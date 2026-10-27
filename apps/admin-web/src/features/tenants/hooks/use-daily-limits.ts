// tenant-quotas · trạng thái thẻ "Hạn mức theo ngày" (platform_admin): nháp 3 ô, lưu cả bộ, đặt lại hôm nay có xác nhận.
import type { DailyLimitKind } from "@ai/contracts";
import { useEffect, useState } from "react";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useResetTenantDailyLimit, useSetTenantDailyLimits, useTenantDailyLimits } from "../api";
import { type DailyDraft, draftOf, sameDraft, toPut } from "../lib/daily-limits-draft";

export function useDailyLimits(tenantId: string) {
  const t = useTr();
  const q = useTenantDailyLimits(tenantId, true);
  const save = useSetTenantDailyLimits(tenantId);
  const reset = useResetTenantDailyLimit(tenantId);
  const [draft, setDraft] = useState<DailyDraft>(() => draftOf(q.data));
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState<DailyLimitKind | null>(null);
  useEffect(() => {
    setDraft(draftOf(q.data));
    setTouched(false);
  }, [q.data]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 503)
      return notifyError(t("tenants.dailyLimits.unavailable"));
    const spec = describeError(err);
    notifyError(t(spec.key, spec.params));
  };
  const body = toPut(draft);
  return {
    q,
    draft,
    touched,
    dirty: !sameDraft(draft, draftOf(q.data)),
    invalid: body === null,
    saving: save.isPending,
    resetting: reset.isPending,
    confirm,
    set: (k: DailyLimitKind, v: string) => setDraft((d) => ({ ...d, [k]: v })),
    blur: () => setTouched(true),
    cancel: () => setDraft(draftOf(q.data)),
    submit: async () => {
      setTouched(true);
      if (!body) return;
      try {
        await save.mutateAsync(body);
        notifySuccess(t("tenants.dailyLimits.saved"));
      } catch (err) {
        fail(err);
      }
    },
    askReset: setConfirm,
    doReset: async () => {
      const kind = confirm;
      setConfirm(null);
      if (!kind) return;
      try {
        await reset.mutateAsync(kind);
        notifySuccess(t("tenants.dailyLimits.resetDone"));
      } catch (err) {
        fail(err);
      }
    },
  };
}

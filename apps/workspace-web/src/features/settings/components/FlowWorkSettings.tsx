// CR-127 · U4 · Cài đặt công ty: «Thời gian tự trả việc đã nhận» (giờ, 1..168 — `claim_release_h`).
// Chỉ quản trị công ty sửa; người khác không thấy khối này (không có thao tác ẩn).

import { CLAIM_RELEASE_H } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { Input } from "@ai/web-kit/ui/kit/input";
import { toast } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
import { SettingsGroup, SettingsRow } from "~/shared/ui/settings-layout";
import { delegationKeys, fetchFlowSettings, saveFlowSettings } from "../api-delegation";
import { claimHoursIssue } from "../lib/delegation";

/** CR-146b: chỉ còn «Thời gian tự trả việc đã nhận»; người ký đặt trong từng quy trình (bước Ký). */
export function FlowWorkSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useSession((s) => s.me);
  const tid = me?.tenant.id ?? "";
  const admin = isCompanyAdmin(me?.role);
  const flow = useQuery({
    queryKey: delegationKeys.flow,
    queryFn: ({ signal }) => fetchFlowSettings(tid, signal),
    enabled: admin && tid !== "",
  });
  const [hours, setHours] = useState<number>(CLAIM_RELEASE_H.default);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (flow.data) setHours(flow.data.claim_release_h);
  }, [flow.data]);
  const save = useMutation({
    mutationFn: async () => {
      await saveFlowSettings(tid, { claim_release_h: hours });
    },
    onSuccess: () => {
      setErr(null);
      toast(t("contracts.work.u4.settings.saved"));
      void qc.invalidateQueries({ queryKey: delegationKeys.flow });
    },
    onError: (e) => {
      const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
      setErr(k ? t(k) : t("contracts.errors.unknown"));
    },
  });
  if (!admin) return null;
  const bad = claimHoursIssue(hours);
  return (
    <SettingsGroup title={t("contracts.work.u4.settings.titleHours")}>
      <div data-testid="flow-work-settings">
        <SettingsRow
          label={t("contracts.work.u4.settings.hours")}
          hint={t("contracts.work.u4.settings.hoursHint")}
          htmlFor="fw-hours"
        >
          <Input
            id="fw-hours"
            type="number"
            min={CLAIM_RELEASE_H.min}
            max={CLAIM_RELEASE_H.max}
            className="h-10 w-28"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </SettingsRow>
        <div className="flex flex-col gap-2 border-t border-rule-soft px-5 py-3">
          {(bad || err) && (
            <p role="alert" className="text-sm text-late" data-testid="flow-work-error">
              {bad ? t("contracts.work.u4.err.CLAIM_HOURS_RANGE") : err}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary w-fit"
            data-testid="flow-work-save"
            disabled={bad || save.isPending || !flow.data}
            onClick={() => save.mutate()}
          >
            {t("contracts.work.u4.settings.save")}
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}

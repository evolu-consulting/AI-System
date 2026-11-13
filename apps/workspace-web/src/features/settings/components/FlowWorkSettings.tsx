// CR-127 · U4 · Cài đặt công ty: «Thời gian tự trả việc đã nhận» (giờ, 1..168 — `claim_release_h`) + nhóm «Người ký HĐ» (`signer_group_id`).
// Chỉ quản trị công ty sửa; người khác không thấy khối này (không có thao tác ẩn).
import { CLAIM_RELEASE_H } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { toast } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { fetchGroups, groupsKey } from "~/features/contract-approval/api";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
import { SettingsGroup, SettingsRow } from "~/shared/ui/settings-layout";
import {
  delegationKeys,
  fetchFlowSettings,
  fetchPartnerSettings,
  saveFlowSettings,
  savePartnerSettings,
} from "../api-delegation";
import { claimHoursIssue } from "../lib/delegation";

/** CR-143: `hours` (tab «Quy trình duyệt») và `signers` (tab «Ký & đối tác») tách hai khối, mỗi khối lưu trường của mình. */
export function FlowWorkSettings({ part }: { part: "hours" | "signers" }) {
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
  const partner = useQuery({
    queryKey: delegationKeys.partner,
    queryFn: ({ signal }) => fetchPartnerSettings(signal),
    enabled: admin,
  });
  const groups = useQuery({
    queryKey: groupsKey,
    queryFn: ({ signal }) => fetchGroups(signal),
    enabled: admin,
  });
  const [hours, setHours] = useState<number>(CLAIM_RELEASE_H.default);
  const [signer, setSigner] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (flow.data) setHours(flow.data.claim_release_h);
  }, [flow.data]);
  useEffect(() => {
    if (partner.data) setSigner(partner.data.signer_group_id ?? "");
  }, [partner.data]);
  const save = useMutation({
    mutationFn: async () => {
      if (part === "hours") await saveFlowSettings(tid, { claim_release_h: hours });
      else if (partner.data)
        await savePartnerSettings({
          ...partner.data,
          signer_group_id: signer === "" ? null : signer,
        });
    },
    onSuccess: () => {
      setErr(null);
      toast(t("contracts.work.u4.settings.saved"));
      void qc.invalidateQueries({ queryKey: delegationKeys.flow });
      void qc.invalidateQueries({ queryKey: delegationKeys.partner });
    },
    onError: (e) => {
      const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
      setErr(k ? t(k) : t("contracts.errors.unknown"));
    },
  });
  if (!admin) return null;
  const bad = claimHoursIssue(hours);
  return (
    <SettingsGroup
      title={t(
        part === "hours"
          ? "contracts.work.u4.settings.titleHours"
          : "contracts.work.u4.settings.titleSigners",
      )}
    >
      <div data-testid="flow-work-settings">
        {part === "hours" && (
          <SettingsRow
            label={t("contracts.work.u4.settings.hours")}
            hint={t("contracts.work.u4.settings.hoursHint")}
            htmlFor="fw-hours"
          >
            <input
              id="fw-hours"
              type="number"
              min={CLAIM_RELEASE_H.min}
              max={CLAIM_RELEASE_H.max}
              className="field h-10 w-28"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </SettingsRow>
        )}
        {part === "signers" && (
          <SettingsRow
            label={t("contracts.work.u4.settings.signers")}
            hint={t("contracts.work.u4.settings.signersHint")}
            htmlFor="fw-signers"
          >
            <select
              id="fw-signers"
              className="field h-10 w-full"
              value={signer}
              onChange={(e) => setSigner(e.target.value)}
            >
              <option value="">{t("contracts.work.u4.settings.signersNone")}</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}
        <div className="flex flex-col gap-2 border-t border-rule-soft px-5 py-3">
          {((part === "hours" && bad) || err) && (
            <p role="alert" className="text-sm text-late" data-testid="flow-work-error">
              {part === "hours" && bad ? t("contracts.work.u4.err.CLAIM_HOURS_RANGE") : err}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary w-fit"
            data-testid="flow-work-save"
            disabled={
              (part === "hours" && bad) ||
              save.isPending ||
              !(part === "hours" ? flow.data : partner.data)
            }
            onClick={() => save.mutate()}
          >
            {t("contracts.work.u4.settings.save")}
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}

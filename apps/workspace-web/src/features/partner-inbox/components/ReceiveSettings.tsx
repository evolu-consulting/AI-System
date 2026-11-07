// CR-124 · q4 · spec §6 · FLOW4-FR-08/09 · khối «Nhận hợp đồng từ đối tác» trong Cài đặt › Quy trình: ngưỡng mức quan trọng theo giá trị (triệu đồng)
// và người phụ trách hợp đồng nhận. Luật nhận (flow «Nhận HĐ…») vẫn đặt ở Công ty › Quy trình — đây chỉ là con số + người. Chỉ quản trị công ty sửa.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Num } from "~/features/settings/components/controls";
import { SettingsGroup, SettingsRow } from "~/shared/ui/settings-layout";
import { useReceiveSettings } from "../hooks/use-partner-queries";
import { draftOf, type ReceiveDraft, settingsIssue, settingsOf } from "../lib/receive-settings";

export function ReceiveSettings({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { on, settings, members, save } = useReceiveSettings(owner);
  const [d, setD] = useState<ReceiveDraft | null>(null);
  useEffect(() => {
    if (settings) setD(draftOf(settings));
  }, [settings]);
  if (!owner || !on || !d) return null;
  const issue = settingsIssue(d);
  return (
    <SettingsGroup title={t("contracts.partner.settings.title")}>
      <div data-testid="partner-receive-settings">
        <SettingsRow label={t("contracts.partner.settings.important")} htmlFor="prs-important">
          <Num
            id="prs-important"
            value={d.importantM}
            min={0}
            max={1_000_000}
            suffix={t("contracts.partner.settings.unit")}
            onChange={(v) => setD({ ...d, importantM: v })}
          />
        </SettingsRow>
        <SettingsRow label={t("contracts.partner.settings.critical")} htmlFor="prs-critical">
          <Num
            id="prs-critical"
            value={d.criticalM}
            min={1}
            max={1_000_000}
            suffix={t("contracts.partner.settings.unit")}
            onChange={(v) => setD({ ...d, criticalM: v })}
          />
        </SettingsRow>
        <SettingsRow label={t("contracts.partner.settings.owner")} htmlFor="prs-owner">
          <select
            id="prs-owner"
            className="field h-10 w-full"
            value={d.owner}
            onChange={(e) => setD({ ...d, owner: e.target.value })}
          >
            <option value="">{t("contracts.partner.settings.ownerNone")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </SettingsRow>
        {issue && (
          <p role="alert" className="text-late">
            {t(`contracts.partner.settings.issue.${issue}`)}
          </p>
        )}
        <button
          type="button"
          data-testid="partner-settings-save"
          className="btn btn-sm btn-primary"
          disabled={issue !== null || save.isPending}
          onClick={() => save.mutate(settingsOf(d))}
        >
          {t("contracts.partner.settings.save")}
        </button>
      </div>
    </SettingsGroup>
  );
}

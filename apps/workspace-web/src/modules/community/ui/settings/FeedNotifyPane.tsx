// COM-FR-39 · CR-130 · ngăn "Bảng tin › Thông báo" trong Cài đặt Sổ Hợp Tác (một trang Cài đặt cho cả app): chọn khi nào nhận thông báo
// (lưu /pack/community/settings, tự lưu). Nạp lười từ hộp thoại Cài đặt chung; dùng chung API với trang Bảng tin (application/boot).
import {
  type CommunitySettings,
  DEFAULT_SETTINGS,
  NOTIFY_KINDS,
  type NotifyKind,
} from "@ai/contracts/community";
import { toast } from "@ai/web-kit/ui/toast";
import { use, useCallback, useEffect, useState } from "react";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "~/shared/ui/settings-layout";
import { ready } from "../../application/boot";
import { t } from "../../i18n";

const HOST_ONLY: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited", "digest"];
const HOST_ONLY_DESC: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited"];
const desc = (k: NotifyKind): string =>
  HOST_ONLY_DESC.includes(k)
    ? t("community.settings.notify.hostOnly")
    : t(`community.settings.notify.${k}Desc`);

export default function FeedNotifyPane() {
  const [{ api }] = use(ready);
  const [isHost, setIsHost] = useState(false);
  const [s, setS] = useState<CommunitySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api.getSettings().then(setS, () => setFailed(true));
  }, [api]);
  useEffect(load, [load]);
  useEffect(() => {
    api.getViewer().then(
      (v) => setIsHost(v.role !== "partner"),
      () => setIsHost(false),
    );
  }, [api]);
  const save = async (next: CommunitySettings) => {
    setS(next);
    await api.saveSettings(next);
    toast(t("community.settings.saved"));
  };
  const cur = s ?? DEFAULT_SETTINGS;
  const kinds = NOTIFY_KINDS.filter((k) => isHost || !HOST_ONLY.includes(k));
  return (
    <SettingsSection
      title={t("community.settings.sections.notify")}
      description={t("community.settings.notify.lead")}
      autosaveNote={t("community.settings.autosave")}
    >
      {failed && (
        <div
          role="alert"
          data-testid="settings-load-error"
          className="mb-4 flex items-center gap-3"
        >
          <b className="text-label">{t("community.settings.loadError")}</b>
          <button type="button" className="text-label text-act underline" onClick={load}>
            {t("community.settings.retry")}
          </button>
        </div>
      )}
      {s && (
        <SettingsGroup>
          {kinds.map((k) => (
            <SettingsRow key={k} label={t(`community.settings.notify.${k}`)} hint={desc(k)}>
              <SettingsSwitch
                checked={cur.notify[k]}
                label={t(`community.settings.notify.${k}`)}
                onChange={(v) => save({ notify: { ...cur.notify, [k]: v } })}
              />
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}
    </SettingsSection>
  );
}

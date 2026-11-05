// COM-FR-39 · Cá nhân: thông báo (lưu /pack/community/settings, tự lưu) + ngôn ngữ vi/en (lưu `community.lang`, như login/i18n).
import {
  type CommunitySettings,
  DEFAULT_SETTINGS,
  NOTIFY_KINDS,
  type NotifyKind,
} from "@ai/contracts/community";
import { SUPPORTED_LOCALES } from "@ai/i18n/locales";
import { useCallback, useEffect, useState } from "react";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSeg,
  SettingsSwitch,
} from "~/shared/ui/settings-layout";
import { useApp } from "../../application/ctx";
import { currentLang, setLang, t } from "../../i18n";

const HOST_ONLY: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited", "digest"];
const HOST_ONLY_DESC: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited"];
const desc = (k: NotifyKind): string =>
  HOST_ONLY_DESC.includes(k)
    ? t("community.settings.notify.hostOnly")
    : t(`community.settings.notify.${k}Desc`);

export function NotifySection() {
  const { api, isHostViewer, toast } = useApp();
  const [s, setS] = useState<CommunitySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api.getSettings().then(setS, () => setFailed(true));
  }, [api]);
  useEffect(load, [load]);
  const save = async (next: CommunitySettings) => {
    setS(next);
    await api.saveSettings(next);
    toast(t("community.settings.saved"));
  };
  const cur = s ?? DEFAULT_SETTINGS;
  const kinds = NOTIFY_KINDS.filter((k) => isHostViewer || !HOST_ONLY.includes(k));
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

export function LangSection() {
  const [lang, setLangState] = useState(currentLang);
  return (
    <SettingsSection
      title={t("community.settings.sections.lang")}
      description={t("community.settings.lang.lead")}
      autosaveNote={t("community.settings.autosave")}
    >
      <SettingsGroup>
        <SettingsRow label={t("community.settings.lang.aria")}>
          <SettingsSeg
            label={t("community.settings.lang.aria")}
            value={lang}
            options={SUPPORTED_LOCALES.map((l) => [l, t(`community.settings.lang.${l}`)] as const)}
            onChange={(l) => {
              setLangState(l);
              void setLang(l);
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

// COM-FR-39 · Cá nhân: thông báo (lưu /pack/community/settings) + ngôn ngữ vi/en (lưu `community.lang`, như login/i18n).
import {
  type CommunitySettings,
  DEFAULT_SETTINGS,
  NOTIFY_KINDS,
  type NotifyKind,
} from "@ai/contracts/community";
import { SUPPORTED_LOCALES } from "@ai/i18n/locales";
import { useCallback, useEffect, useState } from "react";
import { currentLang, setLang, t } from "../../i18n";
import { useApp } from "../ctx";

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
    <>
      <h2>{t("community.settings.sections.notify")}</h2>
      <p className="lead">{t("community.settings.notify.lead")}</p>
      {failed && (
        <div className="row" role="alert" data-testid="settings-load-error">
          <div className="t">
            <b>{t("community.settings.loadError")}</b>
          </div>
          <button type="button" className="btn" onClick={load}>
            {t("community.settings.retry")}
          </button>
        </div>
      )}
      {s &&
        kinds.map((k) => (
          <div className="row" key={k}>
            <div className="t">
              <b>{t(`community.settings.notify.${k}`)}</b>
              <span>{desc(k)}</span>
            </div>
            <button
              type="button"
              className="sw"
              aria-pressed={cur.notify[k]}
              aria-label={t(`community.settings.notify.${k}`)}
              onClick={() => save({ notify: { ...cur.notify, [k]: !cur.notify[k] } })}
            />
          </div>
        ))}
    </>
  );
}

export function LangSection() {
  const [lang, setLangState] = useState(currentLang);
  return (
    <>
      <h2>{t("community.settings.sections.lang")}</h2>
      <p className="lead">{t("community.settings.lang.lead")}</p>
      <fieldset className="swatches" aria-label={t("community.settings.lang.aria")}>
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            className={lang === l ? "btn on" : "btn"}
            aria-pressed={lang === l}
            onClick={() => {
              setLangState(l);
              void setLang(l);
            }}
          >
            {t(`community.settings.lang.${l}`)}
          </button>
        ))}
      </fieldset>
    </>
  );
}

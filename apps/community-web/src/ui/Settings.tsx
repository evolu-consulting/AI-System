// Cài đặt (mockup settings): Tài khoản, Giao diện (màu chủ đạo: Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam), Thông báo (bật/tắt từng loại).
import {
  COMMUNITY_ACCENTS,
  type CommunityAccent,
  type CommunitySettings,
  DEFAULT_SETTINGS,
  NOTIFY_KINDS,
  type NotifyKind,
} from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { initials } from "../lib/format";
import { useApp } from "./ctx";

export const ACCENT_META: Record<CommunityAccent, { label: () => string; color: string }> = {
  indigo: { label: () => t("community.settings.look.indigo"), color: "#4f46e5" },
  blue: { label: () => t("community.settings.look.blue"), color: "#2563eb" },
  teal: { label: () => t("community.settings.look.teal"), color: "#0891b2" },
  green: { label: () => t("community.settings.look.green"), color: "#16a34a" },
  orange: { label: () => t("community.settings.look.orange"), color: "#ea580c" },
};
const notifyKey = (k: NotifyKind, part: "title" | "desc"): string => {
  const base = `community.settings.notify.${k}`;
  const hostOnly = ["newSell", "newBuy", "matchBuy", "priceEdited"].includes(k);
  if (part === "title") return t(base);
  return hostOnly ? t("community.settings.notify.hostOnly") : t(`${base}Desc`);
};
const HOST_ONLY: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited", "digest"];
type Tab = "account" | "look" | "notify";

export function SettingsPage() {
  const { api, viewer, isHostViewer, accent, setAccent, toast } = useApp();
  const [tab, setTab] = useState<Tab>("account");
  const [s, setS] = useState<CommunitySettings>({ ...DEFAULT_SETTINGS, accent });
  useEffect(() => {
    api.getSettings().then(
      (r) => setS({ ...r, accent }),
      () => undefined,
    );
  }, [api, accent]);
  const save = async (next: CommunitySettings) => {
    setS(next);
    await api.saveSettings(next);
    toast(t("community.settings.saved"));
  };
  const kinds = NOTIFY_KINDS.filter((k) => isHostViewer || !HOST_ONLY.includes(k));
  const items: [Tab, string][] = [
    ["account", t("community.settings.tabs.account")],
    ["look", t("community.settings.tabs.look")],
    ["notify", t("community.settings.tabs.notify")],
  ];
  return (
    <div className="ws">
      <nav className="wsside" aria-label={t("community.settings.navLabel")}>
        <div className="mini">
          <span className="av lg t7">{initials(viewer.name)}</span>
          <div>
            <b>{t("community.settings.title")}</b>
            <span>{viewer.name}</span>
          </div>
        </div>
        <div className="sidegroup">
          {items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "sidelink on" : "sidelink"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <main className="wsmain">
        <div className="wscenter">
          <section className="card setbody">
            {tab === "account" && (
              <>
                <h2>{t("community.settings.tabs.account")}</h2>
                <p className="lead">
                  {t("community.settings.account.lead", { org: viewer.orgName })}
                </p>
                <div className="form">
                  <div>
                    <label htmlFor="s-name">{t("community.settings.account.name")}</label>
                    <input id="s-name" className="field" value={viewer.name} readOnly />
                  </div>
                  <div>
                    <label htmlFor="s-org">{t("community.settings.account.company")}</label>
                    <input id="s-org" className="field" value={viewer.orgName} readOnly />
                  </div>
                </div>
              </>
            )}
            {tab === "look" && (
              <>
                <h2>{t("community.settings.tabs.look")}</h2>
                <p className="lead">{t("community.settings.look.lead")}</p>
                <span className="flabel">{t("community.settings.look.accent")}</span>
                <fieldset className="swatches" aria-label={t("community.settings.look.accent")}>
                  {COMMUNITY_ACCENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={accent === a ? "swatch on" : "swatch"}
                      style={{ background: ACCENT_META[a].color }}
                      aria-label={ACCENT_META[a].label()}
                      aria-pressed={accent === a}
                      onClick={() => {
                        setAccent(a);
                        save({ ...s, accent: a });
                      }}
                    />
                  ))}
                </fieldset>
              </>
            )}
            {tab === "notify" && (
              <>
                <h2>{t("community.settings.tabs.notify")}</h2>
                <p className="lead">{t("community.settings.notify.lead")}</p>
                {kinds.map((k) => (
                  <div className="row" key={k}>
                    <div className="t">
                      <b>{notifyKey(k, "title")}</b>
                      <span>{notifyKey(k, "desc")}</span>
                    </div>
                    <button
                      type="button"
                      className="sw"
                      aria-pressed={s.notify[k]}
                      aria-label={notifyKey(k, "title")}
                      onClick={() => save({ ...s, notify: { ...s.notify, [k]: !s.notify[k] } })}
                    />
                  </div>
                ))}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

// COM-FR-31/38 · hộp thoại "Cài đặt chung": mở từ user-menu hoặc `#/settings`, KHÔNG phải route (đóng giữ nguyên trang nền).
// Esc / bấm nền / nút đóng đóng. Nav 3 nhóm theo quyền (lib/settings-sections.ts): Cá nhân · Công ty · Sổ Hợp Tác (chỉ khi caps.contracts).
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import {
  buildSettingsNav,
  findSection,
  type SettingsSection,
  type SettingsSectionId,
} from "../lib/settings-sections";
import { useApp } from "./ctx";
import { IconX } from "./icons";
import { BrandSection, NoPermission, ShtSection } from "./settings/CompanySections";
import { LangSection, NotifySection } from "./settings/PersonalSections";

function Body({ section }: { section: SettingsSection | null }) {
  if (!section) return <NoPermission />;
  if (section.sec) return <ShtSection section={section} />;
  if (section.id === "notify") return <NotifySection />;
  if (section.id === "lang") return <LangSection />;
  return <BrandSection />;
}

function Nav({ sel, onPick }: { sel: SettingsSectionId; onPick: (s: SettingsSectionId) => void }) {
  const { viewer } = useApp();
  const { role, caps, contractsUrl } = viewer;
  const groups = useMemo(
    () => buildSettingsNav({ role, caps, contractsUrl }),
    [role, caps, contractsUrl],
  );
  return (
    <>
      <nav className="wsside" aria-label={t("community.settings.navLabel")}>
        {groups.map((g) => (
          <div className="sidegroup" key={g.id} data-testid={`settings-group-${g.id}`}>
            <b
              className="sidehead"
              title={g.companyWide ? t("community.settings.companyWide") : undefined}
            >
              {t(`community.settings.groups.${g.id}`)}
            </b>
            {g.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={sel === s.id ? "sidelink on" : "sidelink"}
                aria-current={sel === s.id}
                data-testid={`settings-nav-${s.id}`}
                onClick={() => onPick(s.id)}
              >
                {t(`community.settings.sections.${s.id}`)}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="wsmain">
        <div className="wscenter">
          <section className="card setbody">
            <Body section={findSection(groups, sel)} />
          </section>
        </div>
      </main>
    </>
  );
}

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useApp();
  const [sel, setSel] = useState<SettingsSectionId>("notify");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [settingsOpen, closeSettings]);
  if (!settingsOpen) return null;
  return (
    <div className="dlg-scrim">
      <button
        type="button"
        className="dlg-bg"
        tabIndex={-1}
        aria-label={t("community.settings.close")}
        onClick={closeSettings}
      />
      <div
        ref={box}
        className="dlg setdlg"
        role="dialog"
        aria-modal="true"
        aria-label={t("community.settings.title")}
        tabIndex={-1}
      >
        <header className="dlg-head">
          <h2>{t("community.settings.title")}</h2>
          <button
            type="button"
            className="iconbtn"
            aria-label={t("community.settings.close")}
            onClick={closeSettings}
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="dlg-body">
          <div className="ws">
            <Nav sel={sel} onPick={setSel} />
          </div>
        </div>
      </div>
    </div>
  );
}

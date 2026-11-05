// COM-FR-31/38 · hộp thoại "Cài đặt chung": mở từ user-menu hoặc `#/settings`, KHÔNG phải route (đóng giữ nguyên trang nền).
// Dùng bố cục Cài đặt chung của shell (shared/ui/settings-layout). Nav 3 nhóm theo quyền (domain/settings-sections.ts):
// Cá nhân · Công ty · Sổ Hợp Tác (chỉ khi caps.contracts).
import {
  Bell,
  Building2,
  GitBranch,
  Languages,
  Palette,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  SettingsDialogFrame,
  SettingsLayout,
  type SettingsNavGroup,
} from "~/shared/ui/settings-layout";
import { useApp } from "../application/ctx";
import {
  buildSettingsNav,
  findSection,
  type SettingsSection,
  type SettingsSectionId,
} from "../domain/settings-sections";
import { t } from "../i18n";
import { BrandSection, NoPermission, ShtSection } from "./settings/CompanySections";
import { LangSection, NotifySection } from "./settings/PersonalSections";

const ICON = {
  notify: Bell,
  lang: Languages,
  brand: Palette,
  co: Building2,
  rep: Star,
  biz: TrendingUp,
  scout: Search,
  flow: GitBranch,
} as const;

function Body({ section }: { section: SettingsSection | null }) {
  if (!section) return <NoPermission />;
  if (section.sec) return <ShtSection section={section} />;
  if (section.id === "notify") return <NotifySection />;
  if (section.id === "lang") return <LangSection />;
  return <BrandSection />;
}

export function SettingsDialog() {
  const { settingsOpen, closeSettings, viewer } = useApp();
  const [sel, setSel] = useState<SettingsSectionId>("notify");
  const { role, caps, contractsUrl } = viewer;
  const groups = useMemo(
    () => buildSettingsNav({ role, caps, contractsUrl }),
    [role, caps, contractsUrl],
  );
  const navGroups: SettingsNavGroup[] = groups.map((g) => ({
    id: g.id,
    label: t(`community.settings.groups.${g.id}`),
    title: g.companyWide ? t("community.settings.companyWide") : undefined,
    items: g.sections.map((s) => ({
      id: s.id,
      label: t(`community.settings.sections.${s.id}`),
      icon: ICON[s.id],
    })),
  }));
  return (
    <SettingsDialogFrame
      open={settingsOpen}
      onOpenChange={(o) => !o && closeSettings()}
      title={t("community.settings.title")}
    >
      <SettingsLayout
        navLabel={t("community.settings.navLabel")}
        groups={navGroups}
        active={sel}
        onSelect={(id) => setSel(id as SettingsSectionId)}
      >
        <Body section={findSection(groups, sel)} />
      </SettingsLayout>
    </SettingsDialogFrame>
  );
}

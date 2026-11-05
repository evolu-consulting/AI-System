// COM-FR-40..42 · Công ty (màu chủ đạo = brand công ty, chỉ Admin chủ quản) + mục Sổ Hợp Tác (deep-link `?sec=`).
// Mục SHT chỉ được vẽ khi nav có nhóm SHT (caps.contracts) ⇒ không có trong DOM với đối tác/thiếu quyền.
import { COMMUNITY_BRAND_ACCENTS } from "@ai/contracts/community";
import { SettingsRow, SettingsSection } from "~/shared/ui/settings-layout";
import { useApp } from "../../application/ctx";
import { canEditCompany, type SettingsSection as Sec } from "../../domain/settings-sections";
import { t } from "../../i18n";

const BTN = "h-9 rounded-lg border border-act px-3 text-label text-act hover:bg-act-soft";

export function NoPermission() {
  return (
    <div role="alert" data-testid="settings-no-perm">
      <SettingsSection
        title={t("community.settings.noPermTitle")}
        description={t("community.settings.noPerm")}
      >
        {null}
      </SettingsSection>
    </div>
  );
}

/** Mở một mục Sổ Hợp Tác ngay trong hộp thoại Cài đặt của app; chỉ hiện khi module contracts bật + có quyền. */
export function ShtLink({ section, label }: { section: Sec; label?: string }) {
  const { viewer, openContractsSettings } = useApp();
  if (!viewer.contractsUrl || !viewer.caps.contracts) return null;
  return (
    <button
      type="button"
      className={BTN}
      data-testid="settings-sht-link"
      data-sec={section.id}
      onClick={() => openContractsSettings(section.id)}
    >
      {label ?? t("community.settings.sht.openHere")}
    </button>
  );
}

export function ShtSection({ section }: { section: Sec }) {
  return (
    <SettingsSection
      title={t(`community.settings.sections.${section.id}`)}
      description={
        section.readonly ? t("community.settings.sht.readonly") : t("community.settings.sht.lead")
      }
    >
      <ShtLink section={section} />
    </SettingsSection>
  );
}

export function BrandSection() {
  const { viewer, brand } = useApp();
  if (!canEditCompany(viewer.role)) return <NoPermission />;
  return (
    <SettingsSection
      title={t("community.settings.sections.brand")}
      description={t("community.settings.brand.lead")}
    >
      <SettingsRow label={t("community.settings.brand.aria")}>
        <fieldset
          className="m-0 flex gap-2 border-0 p-0"
          aria-label={t("community.settings.brand.aria")}
        >
          {COMMUNITY_BRAND_ACCENTS.map((a) => (
            <span
              key={a}
              className={`size-7 rounded-full border-2 ${brand.accent === a ? "border-ink" : "border-transparent"}`}
              style={{ background: `var(--brand-${a}, var(--act))` }}
              role="img"
              aria-label={t(`community.settings.brand.${a}`)}
              aria-current={brand.accent === a}
            />
          ))}
        </fieldset>
      </SettingsRow>
      {viewer.caps.contracts && (
        <SettingsRow label={t("community.settings.brand.edit")}>
          <ShtLink section={{ id: "co", sec: "co" }} />
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

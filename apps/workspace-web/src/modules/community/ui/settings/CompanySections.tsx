// COM-FR-40..42 · Công ty (màu chủ đạo = brand công ty, chỉ Admin chủ quản) + mục Sổ Hợp Tác (deep-link `?sec=`).
// Mục SHT chỉ được vẽ khi nav có nhóm SHT (caps.contracts) ⇒ không có trong DOM với đối tác/thiếu quyền.
import { COMMUNITY_BRAND_ACCENTS } from "@ai/contracts/community";
import { useApp } from "../../application/ctx";
import { canEditCompany, type SettingsSection } from "../../domain/settings-sections";
import { t } from "../../i18n";

const COLORS: Record<string, string> = {
  indigo: "#4f46e5",
  blue: "#2563eb",
  teal: "#0891b2",
  green: "#16a34a",
  orange: "#ea580c",
  rose: "#e11d48",
};

export function NoPermission() {
  return (
    <div role="alert" data-testid="settings-no-perm">
      <h2>{t("community.settings.noPermTitle")}</h2>
      <p className="lead">{t("community.settings.noPerm")}</p>
    </div>
  );
}

/** Mở một mục Sổ Hợp Tác: thẻ <a> có href thật (mở tab mới/copy được), bấm thường đi qua helper (không chặn UI). */
export function ShtLink({ section, label }: { section: SettingsSection; label?: string }) {
  const { viewer, openContractsSettings } = useApp();
  if (!viewer.contractsUrl || !viewer.caps.contracts) return null;
  // Mở ngay trong dialog Cài đặt chung của app (không sang trang riêng, không đổi URL); chỉ hiện khi module contracts bật + có quyền.
  return (
    <button
      type="button"
      className="btn"
      data-testid="settings-sht-link"
      data-sec={section.id}
      onClick={() => openContractsSettings(section.id)}
    >
      {label ?? t("community.settings.sht.openHere")}
    </button>
  );
}

export function ShtSection({ section }: { section: SettingsSection }) {
  return (
    <>
      <h2>{t(`community.settings.sections.${section.id}`)}</h2>
      <p className="lead">
        {section.readonly ? t("community.settings.sht.readonly") : t("community.settings.sht.lead")}
      </p>
      <ShtLink section={section} />
    </>
  );
}

export function BrandSection() {
  const { viewer, brand } = useApp();
  if (!canEditCompany(viewer.role)) return <NoPermission />;
  return (
    <>
      <h2>{t("community.settings.sections.brand")}</h2>
      <p className="lead">{t("community.settings.brand.lead")}</p>
      <fieldset className="swatches" aria-label={t("community.settings.brand.aria")}>
        {COMMUNITY_BRAND_ACCENTS.map((a) => (
          <span
            key={a}
            className={brand.accent === a ? "swatch on" : "swatch"}
            style={{ background: COLORS[a] }}
            role="img"
            aria-label={t(`community.settings.brand.${a}`)}
            aria-current={brand.accent === a}
          />
        ))}
      </fieldset>
      {viewer.caps.contracts && (
        <ShtLink section={{ id: "co", sec: "co" }} label={t("community.settings.brand.edit")} />
      )}
    </>
  );
}

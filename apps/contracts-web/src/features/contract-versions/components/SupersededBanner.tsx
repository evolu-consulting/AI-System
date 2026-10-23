// CR-097 K3b · HD-FR-102: banner bản bị thay — chỉ đọc hoàn toàn; "Mở bản hiện hành".
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function SupersededBanner({
  byNo,
  currentId,
}: {
  byNo: number | null;
  currentId: string | null;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <div
      role="status"
      data-testid="superseded-banner"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-soon bg-panel p-3 text-sm"
    >
      <span className="font-semibold">
        {byNo == null
          ? t("contracts.versions.supersededNoNo")
          : t("contracts.versions.superseded", { n: byNo })}
      </span>
      <span className="text-dim">{t("contracts.versions.readOnly")}</span>
      {currentId && (
        <button
          type="button"
          className="btn btn-primary btn-sm ml-auto"
          data-testid="open-current"
          onClick={() => void nav({ to: "/contracts/$id", params: { id: currentId } })}
        >
          {t("contracts.versions.openCurrent")}
        </button>
      )}
    </div>
  );
}

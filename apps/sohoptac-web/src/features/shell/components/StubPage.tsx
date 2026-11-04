// PK-FR-10 · TF5 · khung màn của các lát sau (HD2+): tiêu đề + dòng "sẽ có ở bản sau"; nội dung nghiệp vụ không thuộc N1.
import { useTranslation } from "react-i18next";

export function StubPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-page-title">{t(titleKey)}</h1>
      <p className="mt-2 text-body text-dim">{t("contracts.pages.soon")}</p>
    </section>
  );
}

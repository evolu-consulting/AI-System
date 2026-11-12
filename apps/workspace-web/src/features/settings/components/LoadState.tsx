// Trạng thái tải/lỗi của hộp thoại Cài đặt chung (tách khỏi SettingsDialog để file gọn).
import { useTranslation } from "react-i18next";

export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {loading && <p className="text-dim">{t("contracts.common.loading")}</p>}
      {error && (
        <p role="alert" className="text-late">
          {t("contracts.settings.loadFail")}{" "}
          <button type="button" className="underline" onClick={retry}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
    </>
  );
}

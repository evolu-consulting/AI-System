// Trạng thái tải/lỗi của hộp thoại Cài đặt chung (tách khỏi SettingsDialog để file gọn).
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";
import { PaneSkeleton } from "~/components/shared/Refreshing";

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
      {loading && <PaneSkeleton />}
      {error && (
        <p role="alert" className="text-late">
          {t("contracts.settings.loadFail")}{" "}
          <Button variant="link" onClick={retry}>
            {t("contracts.common.retry")}
          </Button>
        </p>
      )}
    </>
  );
}

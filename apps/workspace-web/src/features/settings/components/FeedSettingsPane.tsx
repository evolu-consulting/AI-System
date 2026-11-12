// CR-130 · "Bảng tin › Thông báo" trong hộp thoại Cài đặt chung: ruột của module Cộng đồng, nạp lười (chỉ khi gói Cộng đồng bật + mở mục này).
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { loadFeedSettingsPane } from "~/modules/community/manifest";

const Pane = lazy(loadFeedSettingsPane);

export function FeedSettingsPane() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<p className="text-dim">{t("contracts.common.loading")}</p>}>
      <Pane />
    </Suspense>
  );
}

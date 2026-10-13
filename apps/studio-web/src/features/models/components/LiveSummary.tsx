// HUB-FR-67 · D7 · "Lúc này sẽ chạy bằng…": chỉ hiện `active_step` của server (không tự suy); cảnh báo vàng khi toàn subscription.
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "#/components/ui/alert";
import type { ProfileItem } from "../hooks/use-profiles";

export function LiveSummary({
  profile,
  allSubscription,
}: {
  profile: ProfileItem | null;
  allSubscription: boolean;
}) {
  const { t } = useTranslation();
  const step = profile && profile.active_step !== null ? profile.steps[profile.active_step] : null;
  return (
    <div className="space-y-2">
      {profile ? (
        <p role="status" className="text-body">
          {profile.active_step !== null && step
            ? t("models.profile.live", { n: profile.active_step + 1, key: step.provider_key })
            : t("models.profile.liveNone")}
        </p>
      ) : null}
      {allSubscription ? (
        <Alert className="flex items-start gap-2 border-transparent bg-warning-bg text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{t("models.profile.subOnly")}</p>
        </Alert>
      ) : null}
    </div>
  );
}

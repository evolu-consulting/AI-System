// CR-112 · ADM-FR-80 · nhãn mức Quản trị/Sửa/Xem (+ "không hiệu lực" khi vai vượt trần công ty, ADM-BR-12).
import type { AppRoleLevel } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { LEVEL_KEY } from "../lib/levels";

const TONE: Record<AppRoleLevel, StatusTone> = { read: "off", write: "ok", admin: "info" };

export function LevelBadge({ level }: { level: AppRoleLevel }) {
  const { t } = useTranslation();
  return <StatusBadge tone={TONE[level]}>{t(LEVEL_KEY[level])}</StatusBadge>;
}

export function IneffectiveBadge({ ceiling }: { ceiling: AppRoleLevel | null }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone="warn"
      tooltip={
        ceiling
          ? t("appRoles.ineffective.tip", { level: t(LEVEL_KEY[ceiling]) })
          : t("appRoles.ineffective.off")
      }
    >
      {t("appRoles.ineffective.label")}
    </StatusBadge>
  );
}

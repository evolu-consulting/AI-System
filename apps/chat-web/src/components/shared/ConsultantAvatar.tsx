// CR-022 · CHAT-AC-06, CHAT-AC-30 · người trả lời luôn là "Consultant" + icon EvoluConsulting; không bao giờ hiện agent/provider.
import { useTranslation } from "react-i18next";

export function ConsultantAvatar({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-label font-semibold text-primary-strong">
      <img
        src="/brand/evoluconsulting-icon.svg"
        alt="EvoluConsulting"
        width={22}
        height={22}
        className="size-[22px]"
      />
      <span>{t("answer.who")}</span>
      {children}
    </div>
  );
}

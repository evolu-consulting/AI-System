// ADM-FR-42 · usage-analytics · nhãn hiển thị cho app (bề mặt) và tier model; khoá lạ ⇒ chính khoá.
import { useTranslation } from "react-i18next";

const APPS = ["chat", "contracts", "knowledge", "rooms", "process", "dify", "other"];
const TIERS = ["opus", "sonnet", "haiku", "openai", "other", "unknown"];

export function useAppLabel(): (key: string | null) => string {
  const { t } = useTranslation();
  return (key) =>
    key === null
      ? "—"
      : APPS.includes(key)
        ? t(`usageAnalytics.app.${key}` as "usageAnalytics.app.chat")
        : key;
}

export function useTierLabel(): (key: string | null) => string {
  const { t } = useTranslation();
  return (key) =>
    key !== null && TIERS.includes(key)
      ? t(`usageAnalytics.tier.${key}` as "usageAnalytics.tier.opus")
      : (key ?? "—");
}

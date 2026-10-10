// ADM-FR-67 · CR-056 · P-a F5: nạp lười phần chuỗi `process.usage.*` (admin chỉ nạp `common` + `admin` lúc dò cờ) khi mở tab Token.
import { loadProcessLocale, toSingleBrace } from "@ai/i18n/process-locales";
import { useQuery } from "@tanstack/react-query";
import i18next from "i18next";
import { useTranslation } from "react-i18next";

export function useUsageLocale(): boolean {
  const { i18n } = useTranslation();
  const lng = i18n.language === "vi" ? "vi" : "en";
  const q = useQuery({
    queryKey: ["process", "usage-locale", lng],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const bundle = await loadProcessLocale(lng, ["usage"]);
      i18next.addResourceBundle(lng, "translation", toSingleBrace(bundle), true, true);
      return true;
    },
  });
  return q.data === true;
}

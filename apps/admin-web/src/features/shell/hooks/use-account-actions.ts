// ADM-FR-01 · hành động của menu avatar: đổi ngôn ngữ (đồng bộ server, lỗi thì hoàn lại) và đăng xuất.
import type { Locale } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { patchMyLocale } from "@/features/auth/api";
import { describeError } from "@/lib/errors";
import { session } from "@/lib/session";
import { useTr } from "@/lib/use-translate";

export function useAccountActions() {
  const { i18n } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();

  const changeLocale = useCallback(
    async (locale: Locale) => {
      const previous = i18n.language;
      if (locale === previous) return;
      await i18n.changeLanguage(locale);
      try {
        session.setMe(await patchMyLocale(locale));
      } catch (err) {
        await i18n.changeLanguage(previous);
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      }
    },
    [i18n, tr],
  );

  const signOut = useCallback(async () => {
    await session.logout();
    await navigate({ to: "/login", search: {} });
  }, [navigate]);

  return { changeLocale, signOut };
}

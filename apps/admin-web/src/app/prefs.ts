// prefs-sync · nối kho giao diện/ngôn ngữ dùng chung (web-kit) với i18n + phiên + client HTTP của admin-web.
import type { Me } from "@ai/contracts";
import { type Prefs, prefs } from "@ai/web-kit/prefs/prefs";
import { session } from "@/lib/auth/session";
import { api } from "@/lib/http";
import { i18n } from "./i18n";

export function startPrefs(): void {
  prefs.init({
    applyLocale: (l) => i18n.changeLanguage(l),
    patch: async (body: Partial<Prefs>) => {
      session.setMe(await api<Me>("/auth/me", { method: "PATCH", body }));
    },
  });
  const sync = () => prefs.reconcile(session.getState().me);
  session.subscribe(sync);
  sync();
}

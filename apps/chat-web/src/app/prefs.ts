// prefs-sync · nối kho giao diện/ngôn ngữ dùng chung (web-kit) với i18n + phiên + client HTTP của chat-web.
import { api } from "@ai/web-kit/http";
import { type Prefs, prefs } from "@ai/web-kit/prefs/prefs";
import { session } from "~/lib/auth/session";
import { i18n } from "./i18n";

export function startPrefs(): void {
  prefs.init({
    applyLocale: (l) => i18n.changeLanguage(l),
    patch: (body: Partial<Prefs>) => api("/auth/me", { method: "PATCH", body }),
  });
  const sync = () => prefs.reconcile(session.getState().me);
  session.subscribe(sync);
  sync();
}

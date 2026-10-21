// PK-FR-10 · TF4 · khung màn đăng nhập S01: cột form 520px bên trái + showcase (≥ lg) bên phải — port
// `reference/mgmt-app-contracts/web/src/pages/auth/LoginPage.tsx:123-157`.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import { AppPreview } from "./AppPreview";

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex min-h-dvh bg-panel text-base leading-[1.55]">
      <main className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[520px] lg:shrink-0 lg:px-14">
        <span className="flex items-center gap-2.5">
          <img src="/evolu-icon.svg" alt="" className="h-8 w-8" />
          <span className="text-[17px] font-semibold tracking-tight">
            {t("contracts.app.name")}
          </span>
        </span>
        <div className="mx-auto flex w-full max-w-[384px] flex-1 flex-col justify-center gap-6 py-8">
          {children}
        </div>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-dim">
          <span>
            Evolu Consulting · <span className="font-mono">Intelligent automation</span>
          </span>
          <a href="/terms" className="hover:text-ink hover:underline">
            {t("contracts.gape.legal.terms")}
          </a>
          <a href="/privacy" className="hover:text-ink hover:underline">
            {t("contracts.gape.legal.privacy")}
          </a>
          <span className="ml-auto flex gap-2">
            {(["vi", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={i18n.language === l}
                onClick={() => void i18n.changeLanguage(l)}
                className={i18n.language === l ? "font-semibold text-ink" : "hover:text-ink"}
              >
                {t(l === "vi" ? "contracts.gape.account.langVi" : "contracts.gape.account.langEn")}
              </button>
            ))}
          </span>
        </footer>
      </main>
      <Showcase />
    </div>
  );
}

function Showcase() {
  const { t } = useTranslation();
  return (
    <section
      aria-hidden
      className="auth-show hidden flex-1 flex-col gap-6 overflow-hidden pt-14 pl-14 lg:flex"
    >
      <div className="flex items-start gap-5 pr-12">
        <div className="min-w-0">
          <h2 className="max-w-[18ch] text-[27px] leading-tight font-bold tracking-[-0.015em] text-balance">
            {t("contracts.login.showcaseTitle")}
          </h2>
          <p className="mt-2 text-[15px] text-ink-2">{t("contracts.login.showcaseLead")}</p>
        </div>
        <span className="auth-robot grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white shadow-lg">
          <IconRobot width={30} height={30} />
        </span>
      </div>
      <AppPreview />
    </section>
  );
}

// HUB-FR-72 · khung ứng dụng: skip-link, Sidebar, Topbar, <main id="main">, Toaster.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "#/components/ui/sonner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-label focus:shadow-dialog"
      >
        {t("nav.skip")}
      </a>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <div className="relative flex-1 overflow-y-auto">
            <main
              id="main"
              tabIndex={-1}
              className="mx-auto w-full max-w-content p-page outline-none"
            >
              {children}
            </main>
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </>
  );
}

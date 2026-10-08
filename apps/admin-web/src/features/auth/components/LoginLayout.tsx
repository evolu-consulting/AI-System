// CR-052 phương án C · khung màn Đăng nhập: cột trái 520px (logo + tên app, EN|VI, nội dung giữa, © dưới) + cột phải showcase.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "./LanguageSwitch";

type Props = { appName: string; showcase: ReactNode; children: ReactNode };

export function LoginLayout({ appName, showcase, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen bg-card">
      <main id="main" className="flex w-full shrink-0 flex-col px-6 py-8 sm:px-16 lg:w-[520px]">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/brand/evoluconsulting-icon.svg"
              alt=""
              width={32}
              height={32}
              className="size-8"
            />
            <span className="text-[17px] font-semibold text-foreground">{appName}</span>
          </div>
          <LanguageSwitch />
        </header>
        <div className="mx-auto flex w-full max-w-[392px] flex-1 flex-col justify-center gap-6 py-8">
          {children}
        </div>
        <p className="text-caption text-muted-foreground">{t("auth.login.footer")}</p>
      </main>
      {showcase}
    </div>
  );
}

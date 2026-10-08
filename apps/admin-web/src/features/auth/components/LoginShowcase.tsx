// CR-052 phương án C · cột phải màn Đăng nhập (chỉ ≥ 1024px): nền `accent`, tiêu đề + mô tả + robot, dưới là cửa sổ app mẫu
// tĩnh (`children`, trang trí, aria-hidden) neo sát mép phải/dưới. Không ghi tên công nghệ nào.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RobotHero } from "./RobotArt";

type Props = { tip: string; children: ReactNode };

export function LoginShowcase({ tip, children }: Props) {
  const { t } = useTranslation();
  return (
    <section className="hidden flex-1 flex-col gap-6 overflow-hidden bg-accent pt-14 pl-16 lg:flex">
      <div className="flex items-center gap-6 pr-14">
        <div className="flex flex-1 flex-col gap-2">
          <h2 className="text-[28px] leading-tight font-semibold text-ink-strong dark:text-foreground">
            {t("auth.login.showcase.title")}
          </h2>
          <p className="text-[15px] text-primary-strong">{t("auth.login.showcase.description")}</p>
        </div>
        <RobotHero tip={tip} className="shrink-0" />
      </div>
      <div
        aria-hidden="true"
        className="flex h-[560px] w-[820px] shrink-0 overflow-hidden rounded-tl-[14px] border border-r-0 border-b-0 border-on-ink bg-card shadow-[0_20px_48px_rgba(30,27,75,0.12)]"
      >
        {children}
      </div>
    </section>
  );
}

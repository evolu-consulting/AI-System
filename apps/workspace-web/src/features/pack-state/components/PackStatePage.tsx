// PK-FR-05 · PK-AC06 · TF4 · trang trạng thái gói (ngoài mgmt-app, plan-frontend §7 "Trạng thái mới"): 403 `PACK_FORBIDDEN`
// và `PACK_DISABLED` — heading riêng VI/EN, câu hướng dẫn, nút đăng xuất để đổi tài khoản.
import { useTranslation } from "react-i18next";
import { IconContract } from "~/components/icons";

export type PackBlock = "forbidden" | "disabled";

export function PackStatePage({ kind, onLogout }: { kind: PackBlock; onLogout: () => void }) {
  const { t } = useTranslation();
  const base = `contracts.packState.${kind}`;
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 py-10">
      <section className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-rule bg-panel px-8 py-10 text-center">
        <span
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-2xl bg-act-soft text-act"
        >
          <IconContract width={26} height={26} />
        </span>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{t(`${base}.title`)}</h1>
        <p className="text-sm text-dim">{t(`${base}.body`)}</p>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex h-10 items-center rounded-lg border border-field px-4 text-sm font-semibold hover:bg-sunk"
        >
          {t("contracts.packState.logout")}
        </button>
      </section>
    </div>
  );
}

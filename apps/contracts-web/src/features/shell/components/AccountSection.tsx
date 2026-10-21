// GAP-E #32/#30 · phần menu tài khoản: ngôn ngữ vi/en, đổi mật khẩu + 2FA (trang của nền tảng qua SSO), Điều khoản + Bảo mật.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { type AccountPage, accountPageUrl, saveMyLocale } from "../lib/account-link";

const ITEM = "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-label hover:bg-sunk";
const LOCALES = [
  ["vi", "contracts.gape.account.langVi"],
  ["en", "contracts.gape.account.langEn"],
] as const;

export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const current = i18n.language?.startsWith("en") ? "en" : "vi";
  const label = t("contracts.gape.account.language");
  return (
    <div className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13.5px]">
      <span className="text-ink-2">{label}</span>
      <span
        role="radiogroup"
        aria-label={label}
        className="ml-auto inline-flex rounded-lg border border-rule p-0.5"
      >
        {LOCALES.map(([v, key]) => (
          // biome-ignore lint/a11y/useSemanticElements: nút dạng radio như bộ chọn giao diện
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={current === v}
            onClick={() => {
              if (v === current) return;
              void i18n.changeLanguage(v);
              void saveMyLocale(v);
            }}
            className={`rounded-md px-2.5 py-1 text-[12.5px] ${current === v ? "bg-act-soft font-semibold text-act" : "text-dim hover:text-ink"}`}
          >
            {t(key)}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Đổi mật khẩu / 2FA: mở trang của nền tảng bằng mã SSO một lần. 2FA ẩn với thành viên thường (như admin-web). */
export function AccountLinks({ role, close }: { role: string | undefined; close: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = async (page: AccountPage) => {
    setBusy(true);
    const url = await accountPageUrl(page);
    setBusy(false);
    close();
    if (url) window.location.assign(url);
    else toast(t("contracts.gape.account.openFail"), "late");
  };
  return (
    <>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => go("password")}
        className={ITEM}
      >
        {t("contracts.gape.account.changePassword")}
      </button>
      {role !== "member" && (
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => go("twofa")}
          className={ITEM}
        >
          {t("contracts.gape.account.twofa")}
        </button>
      )}
    </>
  );
}

export function LegalLinks({ close }: { close: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-4 border-t border-rule-soft px-4 py-2 text-caption text-dim">
      <Link to="/terms" role="menuitem" onClick={close} className="hover:text-ink">
        {t("contracts.gape.legal.terms")}
      </Link>
      <Link to="/privacy" role="menuitem" onClick={close} className="hover:text-ink">
        {t("contracts.gape.legal.privacy")}
      </Link>
    </div>
  );
}

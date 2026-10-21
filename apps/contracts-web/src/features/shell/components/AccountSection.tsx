// GAP-E #32/#30 · phần menu tài khoản: đổi mật khẩu + 2FA (trang của nền tảng qua SSO), Điều khoản + Bảo mật.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { type AccountPage, accountPageUrl } from "../lib/account-link";

const ITEM = "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-label hover:bg-sunk";
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

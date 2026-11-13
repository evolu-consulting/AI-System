// GAP-E #32/#30 · phần menu tài khoản: đổi mật khẩu + 2FA (trang của nền tảng qua SSO), Điều khoản + Bảo mật.

import { openInNewTab } from "@ai/web-kit/auth/open-tab";
import { toast } from "@ai/web-kit/ui/toast";
import { Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AccountPage, accountPageUrl } from "../lib/account-link";

const ITEM = "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-label hover:bg-sunk";
/** Đổi mật khẩu / 2FA: mở trang của nền tảng bằng mã SSO một lần. 2FA ẩn với thành viên thường (như admin-web). */
export function AccountLinks({ role, close }: { role: string | undefined; close: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = async (page: AccountPage) => {
    setBusy(true);
    const ok = await openInNewTab(() => accountPageUrl(page));
    setBusy(false);
    close();
    if (!ok) toast(t("contracts.gape.account.openFail"), "late");
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
        <KeyRound size={18} aria-hidden="true" /> {t("contracts.gape.account.changePassword")}
      </button>
      {role !== "member" && (
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => go("twofa")}
          className={ITEM}
        >
          <ShieldCheck size={18} aria-hidden="true" /> {t("contracts.gape.account.twofa")}
        </button>
      )}
    </>
  );
}

export function LegalLinks({ close }: { close: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-4 px-4 pt-1 pb-2 text-caption text-dim">
      <Link to="/terms" role="menuitem" onClick={close} className="hover:text-ink">
        {t("contracts.gape.legal.terms")}
      </Link>
      <Link to="/privacy" role="menuitem" onClick={close} className="hover:text-ink">
        {t("contracts.gape.legal.privacy")}
      </Link>
    </div>
  );
}

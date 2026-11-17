// CR-181 · s4 · mục «Chữ ký của tôi» trong menu tài khoản; chỉ hiện khi công ty bật ký trên tài liệu.
import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMySignature } from "../hooks/use-my-signature";
import { showMenu } from "../lib/gate";

export function MySignatureMenuItem({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const q = useMySignature();
  if (!showMenu(q.data)) return null;
  return (
    <Link
      to={"/my-signature" as never}
      role="menuitem"
      data-testid="menu-my-signature"
      onClick={close}
      className="flex items-center gap-2.5 px-4 py-2.5 text-label hover:bg-sunk"
    >
      <PenLine size={18} aria-hidden="true" /> {t("contracts.mySig.page.menu")}
    </Link>
  );
}

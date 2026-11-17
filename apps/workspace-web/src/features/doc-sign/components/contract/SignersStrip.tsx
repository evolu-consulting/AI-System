// CR-181 · s13 · đầu trang HĐ: dải người ký (Bên A/B). Mỗi người một chip: tên · bên · «n chỗ ký» / «Chưa có chỗ ký» / «Đã ký».
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { signerChips } from "../../lib/contract-view";

export function SignersStrip({ session }: { session: SignSessionOut }) {
  const { t } = useTranslation();
  const chips = signerChips(session);
  if (chips.length === 0) return null;
  return (
    <ul
      data-testid="signers-strip"
      aria-label={t("contracts.docsignc.strip")}
      className="mb-3 flex flex-wrap gap-2"
    >
      {chips.map((c) => (
        <li
          key={c.key}
          data-testid="signer-chip"
          data-state={c.state}
          className="flex items-center gap-2 rounded-md border border-rule bg-panel px-3 py-1 text-sm"
        >
          <span aria-hidden="true" className={c.side === "A" ? "text-act" : "text-late"}>
            ●
          </span>
          <b className="font-medium">{c.name}</b>
          <span className="text-dim">
            {t(c.side === "A" ? "contracts.docsign.tray.sideA" : "contracts.docsign.tray.sideB")}
          </span>
          <span
            className={
              c.state === "signed" ? "text-ok" : c.state === "none" ? "text-late" : "text-dim"
            }
          >
            {c.state === "signed"
              ? t("contracts.docsignc.chipSigned")
              : c.state === "none"
                ? t("contracts.docsignc.chipNone")
                : t("contracts.docsignc.chipCount", { count: c.count })}
          </span>
        </li>
      ))}
    </ul>
  );
}

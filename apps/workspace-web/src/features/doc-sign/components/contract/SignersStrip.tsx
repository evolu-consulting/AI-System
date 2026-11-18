// CR-181 · s13 · đầu trang HĐ: dải người ký (Bên A/B). CR-184: mỗi người một avatar (nhóm: một avatar mỗi thành viên), viền tím Bên A / cam Bên B,
// dấu ✓ nhỏ khi đã ký; tooltip «<họ tên> · Bên A · n chỗ ký / Đã ký» (chữ cũng có trong DOM, ẩn bằng sr-only).
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { usePeopleCards } from "~/features/contract-shared/people";
import { AvatarTip } from "~/shared/ui/AvatarTip";
import { personTip, signerChips } from "../../lib/contract-view";

export function SignersStrip({ session }: { session: SignSessionOut }) {
  const { t } = useTranslation();
  const chips = signerChips(session);
  const cards = usePeopleCards(chips.flatMap((c) => c.people.map((p) => p.id)));
  if (chips.length === 0) return null;
  return (
    <ul
      data-testid="signers-strip"
      aria-label={t("contracts.docsignc.strip")}
      className="mb-3 flex flex-wrap items-center gap-3"
    >
      {chips.map((c) => {
        const side = t(
          c.side === "A" ? "contracts.docsign.tray.sideA" : "contracts.docsign.tray.sideB",
        );
        const state =
          c.state === "signed"
            ? t("contracts.docsignc.chipSigned")
            : c.state === "none"
              ? t("contracts.docsignc.chipNone")
              : t("contracts.docsignc.chipCount", { count: c.count });
        return (
          <li
            key={c.key}
            data-testid="signer-chip"
            data-state={c.state}
            className="flex items-center gap-1"
          >
            {c.people.map((p) => (
              <AvatarTip
                key={p.id ?? p.name}
                name={p.name}
                src={p.id ? cards.get(p.id)?.avatar : null}
                tip={personTip(p, side, state)}
                ring={c.side === "A" ? "ring-act" : "ring-late"}
                badge={
                  c.state === "signed" ? (
                    <span
                      aria-hidden="true"
                      data-testid="signed-mark"
                      className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-ok text-[10px] text-white ring-2 ring-card"
                    >
                      ✓
                    </span>
                  ) : null
                }
              />
            ))}
          </li>
        );
      })}
    </ul>
  );
}

// CR-181 · s13 · đầu trang HĐ: dải người ký (Bên A/B). CR-184: mỗi người một avatar (nhóm: một avatar mỗi thành viên), viền tím Bên A / cam Bên B,
// dấu ✓ nhỏ khi đã ký; tooltip CHỈ họ tên (CR-185, PersonAvatar); «Bên A · Đã ký / n chỗ ký» là chữ cạnh avatar.
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { useTranslation } from "react-i18next";
import { usePeopleCards } from "~/features/contract-shared/people";
import { signerChips } from "../../lib/contract-view";

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
              <PersonAvatar
                key={p.id ?? p.name}
                name={p.name}
                id={p.id}
                src={p.id ? cards.get(p.id)?.avatar : null}
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
            <span className="text-dim text-xs" data-testid="signer-state">
              {side} · {state}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

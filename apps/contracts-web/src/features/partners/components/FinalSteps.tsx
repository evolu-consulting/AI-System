// V2-I · DT-02 · BA §5.1: các bước tới điểm cuối của một vai — (2) điểm dữ liệu = tổng Góp, (3) trộn đánh giá sao, (4) gộp các nhóm theo
// giá trị giao dịch. Mỗi bước một dòng có số thật để người dùng tự kiểm.
import type { RepCellOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { finalSteps, valueShares } from "../lib/partner-v2";

export function FinalSteps({
  cells,
  roleScore,
  manualShare,
}: {
  cells: readonly RepCellOut[];
  roleScore: number | null;
  manualShare: number;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.steps.${k}`, o);
  const shares = valueShares(cells);
  const lines: string[] = [];
  for (const c of cells) {
    if (c.score === null) continue;
    const s = finalSteps(c, manualShare);
    const g = L("group", { group: t(`contracts.pv2.group.${c.group}`) });
    if (s.data === null)
      lines.push(`${g} ${L("starsOnly", { stars: s.starsScore, score: s.score })}`);
    else if (s.starsScore === null)
      lines.push(`${g} ${L("dataOnly", { data: s.data, score: s.score })}`);
    else
      lines.push(
        `${g} ${L("blend", { data: s.data, stars: s.stars, starsScore: s.starsScore, rest: 100 - s.share, s: s.share, score: s.score })}`,
      );
  }
  const scored = cells.filter((c) => c.score !== null);
  if (scored.length > 1)
    lines.push(
      L("role", {
        parts: scored
          .map(
            (c) => `${shares.get(c.group)}% × ${c.score} (${t(`contracts.pv2.group.${c.group}`)})`,
          )
          .join(" + "),
        score: roleScore,
      }),
    );
  if (!lines.length) return null;
  return (
    <section aria-label={L("title")} className="rounded-lg bg-sunk px-3 py-2.5">
      <h4 className="mb-1 text-[13.5px] font-semibold">{L("title")}</h4>
      <ol className="list-decimal space-y-0.5 pl-5 text-[13.5px] text-ink-2">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
      <p className="mt-1 text-[12px] text-dim">{L("foot", { score: roleScore ?? "—" })}</p>
    </section>
  );
}

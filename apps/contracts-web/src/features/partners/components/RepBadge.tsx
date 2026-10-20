// V2-I · DT-01 · huy hiệu điểm uy tín v2: TỐT/KHÁ/CHÚ Ý như HD8, thêm MỚI (chưa đủ số việc tối thiểu) kèm nhãn vai bên dưới.
import type { RepLevel, RepRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ScoreBadge } from "./ScoreBadge";

export function RepBadge({
  score,
  level,
  role,
}: {
  score: number | null;
  level: RepLevel;
  role?: RepRole;
}) {
  const { t } = useTranslation();
  const tile =
    level === "new" || score === null ? (
      <span
        className="flex h-12 w-[54px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-field text-dim"
        role="img"
        aria-label={t("contracts.pv2.newTip")}
      >
        <span className="tnum text-lg leading-none">{score ?? "–"}</span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-wide">
          {t("contracts.pv2.badge.new")}
        </span>
      </span>
    ) : (
      <ScoreBadge score={score} band={level} />
    );
  if (!role) return tile;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {tile}
      <span className="text-[11px] text-dim">{t(`contracts.pv2.roleShort.${role}`)}</span>
    </span>
  );
}

const PILL: Record<RepLevel, string> = {
  good: "bg-ok-bg text-ok",
  fair: "bg-idle-bg text-ink-2",
  watch: "bg-soon-bg text-soon",
  new: "bg-sunk text-dim",
};

/** Mockup NITI `.scorepill`: điểm + tên vai gọn một viên (đầu trang chi tiết). */
export function ScorePill({
  score,
  level,
  role,
}: {
  score: number | null;
  level: RepLevel;
  role: RepRole;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] ${PILL[level]}`}
      title={t(`contracts.pv2.level.${level}`)}
    >
      <b className="tnum">{score ?? "—"}</b>
      {t(`contracts.pv2.roleWord.${role}`)}
    </span>
  );
}

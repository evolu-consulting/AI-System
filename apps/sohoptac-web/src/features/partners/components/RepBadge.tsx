// V2-I · U3 · huy hiệu điểm đối tác theo engine HD8: TỐT/KHÁ/CHÚ Ý (xanh/xám/cam), "MỚI · tạm tính" (điểm tạm, nét đứt) khi chưa đủ số việc,
// "–" khi chưa có việc nào; nhãn vai bên dưới. Cờ đỏ tách khỏi điểm: `RedFlagTag`.
import type { PartnerRow, RepRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { type Badge, badgeOf } from "../lib/partner-score";
import { ScoreBadge } from "./ScoreBadge";

type Row = Pick<PartnerRow, "score" | "band" | "provisional" | "provisional_score">;

function Tile({ b }: { b: Badge }) {
  const { t } = useTranslation();
  if (b.level === "good" || b.level === "fair" || b.level === "watch")
    return <ScoreBadge score={b.shown} band={b.level} />;
  return (
    <span
      className="flex h-12 w-[54px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-field text-dim"
      role="img"
      aria-label={t(b.provisional ? "contracts.pv2.newTip" : "contracts.pv2.noDataTip")}
    >
      <span className="tnum text-lg leading-none">{b.shown ?? "–"}</span>
      {b.provisional && (
        <span className="mt-0.5 text-[9px] leading-tight font-semibold tracking-wide">
          {t("contracts.pv2.badge.new")}
        </span>
      )}
    </span>
  );
}

export function RepBadge({ row, role }: { row: Row; role?: RepRole }) {
  const { t } = useTranslation();
  const tile = <Tile b={badgeOf(row)} />;
  if (!role) return tile;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {tile}
      <span className="text-[11px] text-dim">{t(`contracts.pv2.roleShort.${role}`)}</span>
    </span>
  );
}

const PILL: Record<Badge["level"], string> = {
  good: "bg-ok-bg text-ok",
  fair: "bg-idle-bg text-ink-2",
  watch: "bg-soon-bg text-soon",
  new: "bg-sunk text-dim",
  none: "bg-sunk text-dim",
};

/** Mockup NITI `.scorepill`: điểm + tên vai gọn một viên (đầu trang chi tiết); điểm tạm kèm "MỚI · tạm tính". */
export function ScorePill({ row, role }: { row: Row; role: RepRole }) {
  const { t } = useTranslation();
  const b = badgeOf(row);
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] ${PILL[b.level]}`}
      title={t(`contracts.pv2.level.${b.level}`)}
    >
      <b className="tnum">{b.shown ?? "—"}</b>
      {t(`contracts.pv2.roleWord.${role}`)}
      {b.provisional && (
        <span className="text-[11px] font-semibold">{t("contracts.pv2.badge.new")}</span>
      )}
    </span>
  );
}

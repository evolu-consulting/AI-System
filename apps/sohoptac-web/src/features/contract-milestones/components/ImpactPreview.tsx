// MS-impact · CR-101b (R18, R19, R34): khối "Tác động khi xác nhận" trong hộp xác nhận mốc — số THẬT do máy chủ tính (không ước lượng ở
// client): uy tín đối tác trước → sau (engine hiện hành), kho theo thành phần, còn phải thu/trả của HĐ. Lỗi/đang tính không chặn nút xác nhận.
import type { ObligationImpact, RepPoint } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { type Fault, getImpact } from "../api";

export const impactKey = (id: string, at: string, fault: Fault | undefined) =>
  ["contracts", "obligation-impact", id, at, fault ?? null] as const;

function RepLine({
  r,
  partner,
}: {
  r: NonNullable<ObligationImpact["reputation"]>;
  partner: string;
}) {
  const { t } = useTranslation();
  const pt = (p: RepPoint) =>
    `${p.score ?? t("contracts.msimpact.noScore")} ${t(`contracts.msimpact.level.${p.level}`)}`;
  const d = (r.after.score ?? 0) - (r.before.score ?? 0);
  return (
    <>
      <li
        data-testid="impact-rep"
        className={cn("tnum", d < 0 ? "text-late" : d > 0 ? "text-ok" : "text-ink-2")}
      >
        {t("contracts.msimpact.rep", { name: partner, a: pt(r.before), b: pt(r.after) })}
      </li>
      {!r.counted && <li className="text-dim">{t("contracts.msimpact.notCounted")}</li>}
      {r.pending_fault && (
        <li data-testid="impact-pending" className="text-soon">
          {t("contracts.msimpact.pendingFault")}
        </li>
      )}
    </>
  );
}

export function ImpactPreview({
  id,
  at,
  fault,
  partner,
}: {
  id: string;
  at: string;
  /** Lỗi đang chọn (chỉ gửi khi mốc trễ). */
  fault: Fault | undefined;
  partner: string;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: impactKey(id, at, fault),
    queryFn: ({ signal }) => getImpact(id, { at, fault }, signal),
    enabled: at !== "",
    retry: false,
    staleTime: 10_000,
  });
  if (q.isPending)
    return <p className="text-[12.5px] text-dim">{t("contracts.msimpact.loading")}</p>;
  if (q.isError) return <p className="text-[12.5px] text-dim">{t("contracts.msimpact.failed")}</p>;
  const x = q.data;
  return (
    <div data-testid="impact-preview" className="text-[12.5px]">
      <b className="font-medium">{t("contracts.msimpact.title")}</b>
      <ul className="mt-1 flex flex-col gap-0.5">
        {x.reputation && <RepLine r={x.reputation} partner={partner} />}
        {x.stock.map((s) => (
          <li key={s.component_id} data-testid="impact-stock" className="tnum">
            {t("contracts.msimpact.stock", { name: s.name, a: s.before, b: s.after })}
          </li>
        ))}
        {x.debt && (
          <li data-testid="impact-debt" className="tnum">
            {t(`contracts.msimpact.debt.${x.debt.direction}`, {
              a: vnd(x.debt.before),
              b: vnd(x.debt.after),
            })}
          </li>
        )}
      </ul>
    </div>
  );
}

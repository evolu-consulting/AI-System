// V2-GAPS · C10 · mockup "Uy tín của mình với khách": dải thông tin trên trang Đối tác — việc CỦA MÌNH đã xong trong 90 ngày qua, bao nhiêu
// trễ, lỗi do ai, đối tác bị ghi lỗi nhiều nhất. Chỉ đọc; lỗi của mình KHÔNG trừ điểm đối tác (BA).
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchRepMine, partnerKeys } from "../api";

const DAYS = 90;

export function MineBanner() {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.mine.${k}`, o);
  const q = useQuery({
    queryKey: partnerKeys.mine(DAYS),
    queryFn: ({ signal }) => fetchRepMine(DAYS, signal),
  });
  const m = q.data;
  if (!m) return null;
  const detail =
    m.total === 0
      ? L("none", { days: m.days })
      : m.late === 0
        ? L("allOnTime", { total: m.total, days: m.days })
        : L("someLate", {
            late: m.late,
            total: m.total,
            days: m.days,
            pct: m.on_time_pct,
            ours: m.by_fault.ours,
            partner: m.by_fault.partner,
            unknown: m.by_fault.unknown,
          });
  return (
    <section
      aria-label={L("title")}
      className="mb-4 rounded-xl border border-rule bg-panel px-5 py-3 text-[13.5px]"
    >
      <b>{L("title")}:</b> {detail}
      {m.blamed.length > 0 && (
        <span>
          {" "}
          {L("blamed", { list: m.blamed.map((b) => `${b.name} (${b.late})`).join(", ") })}
        </span>
      )}
    </section>
  );
}

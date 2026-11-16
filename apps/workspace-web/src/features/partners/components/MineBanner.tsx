// V2-GAPS · C10 · mockup "Uy tín của mình với khách": dải thông tin trên trang Đối tác — việc CỦA MÌNH đã xong trong 90 ngày qua, bao nhiêu
// trễ, lỗi do ai, đối tác bị ghi lỗi nhiều nhất. Chỉ đọc; lỗi của mình KHÔNG trừ điểm đối tác (BA).
import { Button } from "@ai/web-kit/ui/kit/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepMine } from "../hooks/use-partner-rep";

const DAYS = 90;

export function MineBanner() {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.mine.${k}`, o);
  const q = useRepMine(DAYS);
  const [open, setOpen] = useState(false);
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
      className="mb-4 rounded-xl border border-rule bg-panel px-5 py-3 text-[13.5px] max-sm:px-4"
    >
      <div className={open ? undefined : "max-sm:line-clamp-2"}>
        <b>{L("title")}:</b> {detail}
        {m.blamed.length > 0 && (
          <span>
            {" "}
            {L("blamed", { list: m.blamed.map((b) => `${b.name} (${b.late})`).join(", ") })}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="hidden px-0 font-semibold text-act max-sm:inline-flex"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {L(open ? "less" : "more")}
      </Button>
    </section>
  );
}

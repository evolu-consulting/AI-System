// CR-123 U2 · khối 3 dòng của một bước trên thẻ duyệt: trạng thái (đậm) · lý do · bước kế / ai cần làm gì.
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { StatusLines as Lines } from "../lib/card-status";

/** Người xem có phải người cần quyết bước đang mở (để dòng "bước kế" nói "Bạn cần…" hay "Chờ X"). */
export const CanActContext = createContext(false);
export const useCanAct = () => useContext(CanActContext);

export function StatusLines({ lines, alert }: { lines: Lines; alert?: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-approval="status-lines" className="mt-0.5 text-caption">
      <p className={`font-medium ${alert ? "text-late" : ""}`} data-line="state">
        {t(lines.state.key, lines.state.vars)}
      </p>
      <p className="text-dim" data-line="reason">
        {t(lines.reason.key, lines.reason.vars)}
      </p>
      <p className="text-dim" data-line="next">
        {t(lines.next.key, lines.next.vars)}
      </p>
    </div>
  );
}

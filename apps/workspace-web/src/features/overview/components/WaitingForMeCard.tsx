// CR-125 · x1 · thẻ đầu Tổng quan "Chờ bạn: N ký · M duyệt" — giám đốc vào là thấy việc của mình (trước đây "Cần xử lý: 0 việc" dù có HĐ chờ ký).
// Đếm từ cùng đọc `GET /my-work` với trang "Chờ tôi duyệt"; bấm ⇒ sang trang đó (có cả danh sách ký). Không có việc ⇒ không hiện thẻ.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMyApprovals } from "../hooks/use-overview";
import { waitingOf } from "../lib/waiting";

export function WaitingForMeCard() {
  const { t } = useTranslation();
  const q = useMyApprovals();
  const w = waitingOf(q.data);
  if (w.total === 0) return null;
  return (
    <Link
      to="/contracts/approvals"
      data-testid="waiting-for-me"
      className="mb-4 flex items-center gap-3 rounded-lg border border-late/40 bg-late/5 px-5 py-3.5 hover:bg-late/10 max-sm:px-4"
    >
      <span
        aria-hidden
        className="tnum grid h-9 min-w-9 place-items-center rounded-full bg-late px-2 text-[15px] font-bold text-white"
      >
        {w.total}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-semibold">
          {t("contracts.waiting.title", { sign: w.sign, approve: w.approve })}
        </b>
        <span className="block text-[12.5px] text-dim">{t("contracts.waiting.hint")}</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-act">{t("contracts.waiting.open")}</span>
    </Link>
  );
}

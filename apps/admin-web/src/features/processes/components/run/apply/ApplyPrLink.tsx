// HUB-FR-129 · FC12 · PC2-R15 · liên kết PR: `<a>` chỉ khi `pr_url` bắt đầu https:// (kiểm lại phòng thủ); không hợp lệ ⇒ chỉ chữ.
import type { ApplyStageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { prLinkOk } from "../../../lib/apply-view";

const K = "process.common.apply.";

export function ApplyPrLink({
  view,
  short = false,
}: {
  view: Pick<ApplyStageView, "pr_url" | "pr_number">;
  /** Thread: hiện `#n ↗` thay vì `PR #n ↗`. */
  short?: boolean;
}) {
  const { t } = useTranslation();
  const n = view.pr_number;
  if (n === null) return null;
  const text = short ? `#${n}` : t(`${K}pr`, { n });
  if (!prLinkOk(view)) return <span className="font-medium">{text}</span>;
  return (
    <a
      href={view.pr_url as string}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t(`${K}prAria`, { n })}
      className="font-medium text-primary underline underline-offset-2"
    >
      {`${text} ↗`}
    </a>
  );
}

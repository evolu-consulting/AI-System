// HUB-FR-128 · P-c1 §1.3 · dòng tóm tắt tự sửa mã ở thẻ thread: "Tự sửa mã" · Vòng k · kiểm gần nhất · +i −d · n file · "Xem diff".
import type { AutofixStageView } from "@ai/contracts/chat";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { lastCheck, secondsLabel } from "../../../lib/autofix-view";

const K = "process.common.autofix.";

type Props = {
  view: AutofixStageView;
  /** Cuộn tới khối kết quả của giai đoạn. */
  onView: () => void;
};

const CHECK_TONE = { ok: "ok", no_changes: "off", check_failed: "err" } as const;

function checkText(
  view: AutofixStageView,
  lang: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const c = lastCheck(view, lang);
  if (c.kind === "ok") return t(`${K}testOk`, { sec: c.seconds });
  if (c.kind === "no_changes") return t(`${K}noChanges.label`);
  if (!c.group) return t(`${K}checkFailed.label`);
  const group = t(`${K}group.${c.group}`, {
    code: view.test?.exit_code ?? "-",
    sec: secondsLabel(view.test?.duration_ms ?? 0, lang),
  });
  return t(`${K}checkFailed.short`, { group });
}

export function AutofixSummary({ view, onView }: Props) {
  const { t, i18n } = useTranslation();
  const st = view.diff_stats;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      <StatusBadge tone="info">{t(`${K}title`)}</StatusBadge>
      <StatusBadge tone="off">{t(`${K}round`, { n: view.round })}</StatusBadge>
      <span className="text-muted-foreground">{t(`${K}lastCheck`)}</span>
      <StatusBadge tone={CHECK_TONE[view.status] ?? "ok"}>
        {checkText(view, i18n.language, t)}
      </StatusBadge>
      {st && (
        <span className="text-muted-foreground">
          {`+${st.insertions} −${st.deletions} · ${t(`${K}diffStat`, { n: st.files })}`}
        </span>
      )}
      {view.diff_file && (
        <Button type="button" size="sm" variant="outline" onClick={onView}>
          {t(`${K}viewDiff`)}
        </Button>
      )}
    </div>
  );
}

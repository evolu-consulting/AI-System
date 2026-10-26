// U3 · R46 · lịch sử đổi cách tính điểm (`GET /scoring/:role/history`): phiên bản, ngày, người lưu, tóm tắt thay đổi.
import type { PartnerRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { useScoringHistory } from "../hooks/use-scoring";
import { Panel } from "./controls";

export function ScoringHistory({ role }: { role: PartnerRole }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, unknown>) => t(`contracts.settings.score.${k}`, o);
  const q = useScoringHistory(role);
  const rows = q.data ?? [];
  return (
    <Panel title={s("historyTitle")}>
      {rows.length === 0 ? (
        <p className="px-5 py-3 text-label text-dim">{s("historyNone")}</p>
      ) : (
        <ul data-testid="scoring-history">
          {rows.map((h) => (
            <li
              key={h.version}
              className="border-t border-rule-soft px-5 py-2.5 text-label first:border-t-0"
            >
              <b>{s("version", { n: h.version })}</b>
              <span className="text-dim">
                {" "}
                · {viDate(h.at)}
                {h.by ? ` · ${h.by}` : ""}
              </span>
              <span className="block text-caption text-dim">{h.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

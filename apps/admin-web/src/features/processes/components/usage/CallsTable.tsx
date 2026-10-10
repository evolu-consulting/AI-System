// ADM-FR-67 · P-a F5: bảng lượt gọi (Vai · Agent · Model · Thời gian · Vào · Ra · Cache · Tổng).
import type { UsageCall } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cacheOf, formatSeconds, formatTokens, modelLabel, roleKey } from "../../lib/usage-view";

const COLS = ["role", "agent", "model", "time"] as const;
const NUM = "px-2 py-1 text-right tabular-nums";

export const CallsTable = memo(function CallsTable({
  label,
  calls,
}: {
  label: string;
  calls: readonly UsageCall[];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <table aria-label={label} className="w-full text-caption">
      <thead className="text-muted-foreground">
        <tr>
          {COLS.map((c) => (
            <th key={c} scope="col" className="px-2 py-1 text-left font-medium">
              {t(`process.usage.col.${c}`)}
            </th>
          ))}
          {(["in", "out", "cache"] as const).map((c) => (
            <th key={c} scope="col" className={`${NUM} font-medium`}>
              {t(`process.usage.kpi.${c}`)}
            </th>
          ))}
          <th scope="col" className={`${NUM} font-medium`}>
            {t("process.usage.col.total")}
          </th>
        </tr>
      </thead>
      <tbody>
        {calls.map((c) => (
          <tr key={c.step_id} className="border-t border-border">
            <td className="px-2 py-1">{t(roleKey(c.role))}</td>
            <td className="px-2 py-1">{c.agent.name}</td>
            <td className="px-2 py-1">{modelLabel(c.model)}</td>
            <td className="px-2 py-1">{formatSeconds(c.latency_ms, lang)}</td>
            <td className={NUM}>{formatTokens(c.tokens.input, lang)}</td>
            <td className={NUM}>{formatTokens(c.tokens.output, lang)}</td>
            <td className={NUM}>{formatTokens(cacheOf(c.tokens), lang)}</td>
            <td className={NUM}>{formatTokens(c.tokens.total, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

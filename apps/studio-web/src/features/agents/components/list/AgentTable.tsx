// HUB-FR-60 · H4a-R11 · bảng danh sách agent (không cột "24 giờ"; ≤ 200 dòng nên không virtualize — plan-frontend §8).
import type { AgentListItem, SimilarAgent } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { AgentRow, type RowActions } from "./AgentRow";

type Props = {
  items: readonly AgentListItem[];
  overlaps: Map<string, SimilarAgent[]>;
  locale: "vi" | "en";
} & RowActions;

const COLS = ["agent", "runtime", "profile", "workflow", "tenant", "status", "actions"] as const;

export function AgentTable({ items, overlaps, locale, ...actions }: Props) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table aria-label={t("agents.tableLabel")}>
        <TableHeader>
          <TableRow>
            {COLS.map((c) => (
              <TableHead key={c} className={c === "actions" ? "w-12" : undefined}>
                <span className={c === "actions" ? "sr-only" : undefined}>
                  {t(`agents.col.${c}`)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              locale={locale}
              overlap={overlaps.get(a.id)}
              {...actions}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

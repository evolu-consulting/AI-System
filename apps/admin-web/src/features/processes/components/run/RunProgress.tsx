// ADM-FR-67 · CR-056 · P-a F5: tab "Tiến độ" — bảng giai đoạn (trạng thái, lần chạy, các phiên bản kết quả).
import type { StageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplySummary } from "./apply/ApplySummary";
import { autofixAnchor } from "./autofix/AutofixBlocks";
import { AutofixSummary } from "./autofix/AutofixSummary";
import type { OutputTarget } from "./OutputDialog";
import { StageStatus } from "./StageStatus";

type Props = { stages: readonly StageView[]; onView: (t: OutputTarget) => void };

export function RunProgress({ stages, onView }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const L = (k: string) => t(`process.admin.run.col.${k}`);
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <caption className="sr-only">{t("process.admin.run.tab.progress")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{L("stage")}</TableHead>
            <TableHead>{L("executor")}</TableHead>
            <TableHead>{L("status")}</TableHead>
            <TableHead className="text-right">{L("attempt")}</TableHead>
            <TableHead>{L("outputs")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stages.map((s) => (
            <TableRow key={s.idx}>
              <TableCell>
                {s.idx + 1}. {s.name}
                {s.autofix && (
                  <AutofixSummary
                    view={s.autofix}
                    onView={() =>
                      document
                        .getElementById(autofixAnchor(s.idx))
                        ?.scrollIntoView({ block: "start" })
                    }
                  />
                )}
                {s.apply && <ApplySummary view={s.apply} />}
              </TableCell>
              <TableCell>{s.executor.name[lang]}</TableCell>
              <TableCell>
                <StageStatus stage={s} />
              </TableCell>
              <TableCell className="text-right">
                {s.attempt}/{s.attempt_limit}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {s.outputs.length === 0 ? "—" : null}
                  {s.outputs.map((o) => (
                    <Button
                      key={o.id}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onView({
                          id: o.id,
                          stage: s.name,
                          version: o.version,
                          stageIdx: s.idx,
                        })
                      }
                    >
                      {t("process.admin.run.viewOutput")}
                      <span className="text-muted-foreground">v{o.version}</span>
                    </Button>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// CR-121 · R-3: ngăn "Nhật ký bước n" — tab Cơ bản (câu dễ hiểu, người xử lý, kết quả) / Gỡ lỗi (chỉ khi server trả debug).
import type { RunStageLog } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClock } from "@/lib/format";
import { formatDuration, hasDebugTab } from "../../lib/run-detail-view";
import type { OutputTarget } from "../run/OutputDialog";
import { StepDebug } from "./StepDebug";

const TONE: Record<RunStageLog["stage"]["state"], StatusTone> = {
  done: "ok",
  running: "info",
  error: "err",
  needs_decision: "warn",
  skipped: "off",
  not_reached: "off",
  cancelled: "off",
};

type Props = {
  idx: number | null;
  fallbackName: string;
  log: RunStageLog | undefined;
  loading: boolean;
  failed: boolean;
  canRerunStep: boolean;
  onRerunStep: (idx: number, name: string) => void;
  onViewOutput: (t: OutputTarget) => void;
  onClose: () => void;
};

export function StepDrawer(p: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const st = p.log?.stage;
  const T = (k: string, o?: Record<string, unknown>) => t(`process.admin.runDetail.${k}`, o);
  return (
    <DetailDrawer
      open={p.idx !== null}
      onClose={p.onClose}
      kind={T("drawer.kind", { n: (p.idx ?? 0) + 1 })}
      title={st?.name ?? p.fallbackName}
      status={st ? { label: T(`state.${st.state}`), tone: TONE[st.state] } : undefined}
      line={st ? st.executor.name[lang] : undefined}
      facts={
        st
          ? [
              { k: T("fact.started"), v: st.started_at ? formatClock(st.started_at) : "—" },
              { k: T("fact.duration"), v: formatDuration(st.duration_ms) },
              { k: T("fact.attempt"), v: `${st.attempt}/${st.attempt_limit}` },
            ]
          : undefined
      }
    >
      {p.loading && <Skeleton className="h-24 w-full" />}
      {p.failed && (
        <p role="alert" className="text-body text-danger">
          {T("drawer.loadFail")}
        </p>
      )}
      {p.log && (
        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">{T("drawer.basic")}</TabsTrigger>
            {hasDebugTab(p.log.level) && (
              <TabsTrigger value="debug">{T("drawer.debug")}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="basic" className="space-y-3">
            <BasicTab log={p.log} lang={lang} onViewOutput={p.onViewOutput} />
          </TabsContent>
          {p.log.debug && (
            <TabsContent value="debug">
              <StepDebug debug={p.log.debug} />
            </TabsContent>
          )}
        </Tabs>
      )}
      {p.canRerunStep && p.idx !== null && (
        <Button
          variant="outline"
          onClick={() => p.onRerunStep(p.idx ?? 0, st?.name ?? p.fallbackName)}
        >
          {T("ctl.rerun-step.button")}
        </Button>
      )}
    </DetailDrawer>
  );
}

function BasicTab({
  log,
  lang,
  onViewOutput,
}: {
  log: RunStageLog;
  lang: "vi" | "en";
  onViewOutput: (t: OutputTarget) => void;
}) {
  const { t } = useTranslation();
  const T = (k: string) => t(`process.admin.runDetail.${k}`);
  const note = log.error_text ?? log.skip_reason;
  return (
    <>
      {note && <p className="rounded-lg bg-muted p-3 text-body">{note[lang]}</p>}
      {(log.stage.executor.kind === "notify" || log.stage.executor.kind === "wait_until") && (
        <p className="text-body text-muted-foreground" data-testid="step-kind-hint">
          {T(`kindHint.${log.stage.executor.kind}`)}
        </p>
      )}
      {log.tasks.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {log.tasks.map((k) => (
            <li key={k.id} className="rounded-lg border border-border p-3 text-body">
              <div className="font-medium">
                {k.outcome ? k.outcome[lang] : T(`taskKind.${k.kind}`)}
              </div>
              {k.assignees.length > 0 && (
                <div className="text-muted-foreground">{k.assignees.join(", ")}</div>
              )}
              {k.decided_by && (
                <div className="text-muted-foreground">
                  {k.decided_by.display_name}
                  {k.decided_at ? ` · ${formatClock(k.decided_at)}` : ""}
                </div>
              )}
              {[k.question, k.answer, k.comment].filter(Boolean).map((x) => (
                <p key={x} className="m-0 mt-1 whitespace-pre-wrap break-words">
                  {x}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {log.outputs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {log.outputs.map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant="outline"
              onClick={() =>
                onViewOutput({
                  id: o.id,
                  stage: log.stage.name,
                  version: o.version,
                  stageIdx: log.stage.idx,
                })
              }
            >
              {T("drawer.viewOutput")}
              <span className="text-muted-foreground">v{o.version}</span>
            </Button>
          ))}
        </div>
      )}
      {!note && log.tasks.length === 0 && log.outputs.length === 0 && (
        <p className="text-body text-muted-foreground">{T("drawer.empty")}</p>
      )}
    </>
  );
}

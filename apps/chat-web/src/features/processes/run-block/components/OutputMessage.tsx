// CHAT-AC-52/53 · plan-frontend-thread §3: tin `output` — kết quả một giai đoạn, các bước, phiên bản, thẻ kiểm đính kèm.
import type { OutputRef, ProcessRunFullView } from "@ai/contracts/chat";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";
import { OutputView } from "../../shared/components/OutputView";
import { TaskWaitingNote } from "../../shared/components/TaskWaitingNote";
import { useThreadRun } from "../../shared/hooks/use-thread-run";
import { formatSeconds, formatTokens } from "../../shared/lib/format";
import { stepsSummary } from "../../shared/lib/thread-task";
import type { ThreadMessageProps } from "../../shared/types";
import { ReviewTaskCard } from "./ReviewTaskCard";

export type OutputMessageProps = ThreadMessageProps<"output">;

type Part = OutputMessageProps["part"];

function StepList({ steps, lng }: { steps: Part["steps"]; lng: string }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1 border-t border-row-divider pt-2 text-caption text-secondary-foreground">
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: bước không có id ổn định; thứ tự cố định theo lượt gọi.
        <li key={`${s.agent.key}-${i}`} className="flex flex-wrap gap-x-1.5">
          <span className="font-medium">{t(`process.thread.role.${s.role}`)}</span>
          <span aria-hidden>·</span>
          {t("process.thread.output.step", {
            agent: s.agent.name,
            model: s.model ?? "—",
            seconds: formatSeconds(s.ms, lng),
            tokens: formatTokens(s.tokens, lng),
          })}
        </li>
      ))}
    </ul>
  );
}

function Versions({
  runId,
  outputs,
  defaultId,
}: {
  runId: string;
  outputs: OutputRef[];
  defaultId: string;
}) {
  const { t } = useTranslation();
  const [cur, setCur] = useState(defaultId);
  if (outputs.length <= 1) return <OutputView runId={runId} outputId={defaultId} />;
  return (
    <Tabs value={cur} onValueChange={setCur}>
      <TabsList aria-label={t("process.run.pane.versions")} className="mb-2">
        {outputs.map((o) => (
          <TabsTrigger key={o.id} value={o.id}>{`v${o.version}`}</TabsTrigger>
        ))}
      </TabsList>
      {outputs.map((o) => (
        <TabsContent key={o.id} value={o.id}>
          <OutputView runId={runId} outputId={o.id} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function OutputMessage({ part }: OutputMessageProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const runId = part.process_run_id;
  const { view: raw, slot } = useThreadRun(runId, part.review_task_id);
  const view = raw?.access === "full" ? (raw as ProcessRunFullView) : undefined;
  const mineOpen = slot.state === "mine";
  const [steps, setSteps] = useState(false);
  const [content, setContent] = useState(mineOpen);
  const summary = stepsSummary(part.steps);
  const stageNo = part.stage_idx + 1;
  const execName = part.executor.name[lng === "vi" ? "vi" : "en"];
  const stageOutputs = view?.stages[part.stage_idx]?.outputs ?? [part.output];
  return (
    <article
      aria-label={t("process.thread.output.aria", {
        stage: part.stage_name,
        version: part.output.version,
      })}
      className="my-1.5 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4"
    >
      <p className="font-semibold text-foreground">
        {t("process.thread.output.title", { n: stageNo, stage: part.stage_name })}
      </p>
      <p className="text-caption text-muted-foreground">
        {t(
          part.executor.kind === "team"
            ? "process.thread.output.byTeam"
            : "process.thread.output.by",
          {
            name: execName,
          },
        )}
      </p>
      <p className="text-caption text-secondary-foreground">
        {t("process.thread.output.summary", {
          count: summary.count,
          seconds: formatSeconds(summary.ms, lng),
          tokens: formatTokens(summary.tokens, lng),
        })}
      </p>
      {part.steps.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={steps}
            onClick={() => setSteps((v) => !v)}
            className="flex items-center gap-1 self-start text-caption text-primary-strong hover:underline"
          >
            <ChevronDown className={cn("size-3.5", steps && "rotate-180")} aria-hidden />
            {t("process.thread.output.steps", { count: summary.count })}
          </button>
          {steps && <StepList steps={part.steps} lng={lng} />}
        </>
      )}
      {!part.output.template_ok && part.output.template_missing.length > 0 && (
        <p className="rounded-lg bg-warning-bg px-3 py-2 text-caption text-warning">
          {t("process.run.pane.missing", { list: part.output.template_missing.join(", ") })}
        </p>
      )}
      <button
        type="button"
        aria-expanded={content}
        onClick={() => setContent((v) => !v)}
        className="self-start text-caption text-primary-strong hover:underline"
      >
        {t(content ? "process.thread.output.hide" : "process.thread.output.show")}
      </button>
      {content && <Versions runId={runId} outputs={stageOutputs} defaultId={part.output.id} />}
      {part.after === "auto" && (
        <p className="text-caption text-muted-foreground">{t("process.thread.output.auto")}</p>
      )}
      {part.review_task_id && slot.state === "mine" && (
        <ReviewTaskCard runId={runId} task={slot.task} view={view} />
      )}
      {part.review_task_id && slot.state === "waiting" && <TaskWaitingNote open={slot.open} />}
    </article>
  );
}

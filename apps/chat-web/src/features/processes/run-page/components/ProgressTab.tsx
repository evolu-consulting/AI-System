// CHAT-AC-54…56 · HUB-BR-25 · PF3: tab "Tiến độ". `full` ⇒ StageStrip + kết quả từng giai đoạn + TaskPanel (my_tasks).
// `task` ⇒ banner ngoài phòng + StageStrip (chỉ tên/trạng thái) + TaskPanel; U5 (`outputs`) ⇒ khối "Kết quả".
// Render NGHIÊM theo trường có trong view: `task` KHÔNG có `history`/`outputs` ⇒ không lộ (readiness lần 3).
import type { OutputRef, ProcessRunTaskView, ProcessRunView } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OutputView } from "../../shared/components/OutputView";
import { StageStrip } from "../../shared/components/StageStrip";
import { TaskPanel } from "../../shared/components/TaskPanel";
import { groupTasksByStep } from "../../shared/lib/steps";
import { pendingDecisionTask } from "../../shared/lib/thread-task";
import { StageOutputs } from "./StageOutputs";
import { StepSection } from "./StepSection";
import { TaskAccessBanner } from "./TaskAccessBanner";

export function ProgressTab({ view }: { view: ProcessRunView }) {
  if (view.access === "full") {
    // E-P7: admin quyết được nhưng không là assignee ⇒ my_tasks rỗng; dựng thẻ "Cần người quyết" từ view.decision.
    const decision = pendingDecisionTask(view);
    return (
      <div className="flex flex-col gap-4 p-4">
        <StageStrip
          stages={view.stages.map((s) => ({ idx: s.idx, name: s.name, status: s.status }))}
        />
        {view.stages
          .filter((s) => s.outputs.length > 0)
          .map((s) => (
            <StageOutputs key={s.idx} runId={view.id} stage={s} />
          ))}
        <StepTasks view={view} />
        {decision && <TaskPanel key={decision.id} runId={view.id} task={decision} view={view} />}
      </div>
    );
  }
  return <TaskProgress view={view} />;
}

/** Q7: việc mở của ≥ 2 giai đoạn cùng bước ⇒ gom dưới `group` "Bước n"; còn lại hiện trần như cũ. */
function StepTasks({ view }: { view: ProcessRunView }) {
  const groups = groupTasksByStep(view.my_tasks, view.stages);
  return groups.map((g) => {
    const cards = g.tasks.map((task) => (
      <TaskPanel
        key={task.id}
        runId={view.id}
        task={task}
        view={view.access === "full" ? view : undefined}
      />
    ));
    const open = g.tasks.filter((x) => x.status === "open").length;
    return open >= 2 ? (
      <StepSection key={g.step} step={g.step}>
        {cards}
      </StepSection>
    ) : (
      cards
    );
  });
}

function TaskProgress({ view }: { view: ProcessRunTaskView }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <TaskAccessBanner hasTasks={view.my_tasks.length > 0} />
      <StageStrip stages={view.stages} />
      <StepTasks view={view} />
      {view.outputs && view.outputs.length > 0 && (
        <TaskOutputs runId={view.id} outputs={view.outputs} view={view} />
      )}
    </div>
  );
}

/** U5 (người bắt đầu đã rời phòng): mọi phiên bản kết quả, mở từng bản bằng "Xem kết quả". */
function TaskOutputs({
  runId,
  outputs,
  view,
}: {
  runId: string;
  outputs: OutputRef[];
  view: ProcessRunTaskView;
}) {
  const { t } = useTranslation();
  // OutputRef không mang tên giai đoạn ⇒ dùng tên giai đoạn cuối đã có trạng thái (đủ cho 1 output; gap contract ghi báo cáo).
  const stageName = [...view.stages].reverse().find((s) => s.status !== "pending")?.name ?? "";
  return (
    <section aria-label={t("process.inbox.run.outputs")} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("process.inbox.run.outputs")}</h3>
      {outputs.map((o) => (
        <OutputRow key={o.id} runId={runId} output={o} stageName={stageName} />
      ))}
    </section>
  );
}

function OutputRow({
  runId,
  output,
  stageName,
}: {
  runId: string;
  output: OutputRef;
  stageName: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t("process.inbox.run.outputTitle", { stage: stageName, n: output.version })}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-md border border-input px-2.5 py-1 text-caption font-medium hover:bg-muted"
        >
          {t("process.inbox.run.viewOutput")}
        </button>
      </div>
      {open && <OutputView runId={runId} outputId={output.id} />}
    </div>
  );
}

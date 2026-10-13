// CHAT-AC-54…56 · HUB-BR-25 · PF3 + P-b2 (A5): tab "Tiến độ". `full` ⇒ StageStrip + (nhóm "Bước n" khi có bước song song/đã quay lại
// | kết quả từng giai đoạn) + Lịch sử quay lại + TaskPanel.
// `task` ⇒ banner ngoài phòng + StageStrip (chỉ tên/trạng thái) + TaskPanel; U5 (`outputs`) ⇒ khối "Kết quả".
// Render NGHIÊM theo trường có trong view: `task` KHÔNG có `history`/`outputs` ⇒ không lộ (readiness lần 3).
import type {
  OutputRef,
  ProcessRunFullView,
  ProcessRunTaskView,
  ProcessRunView,
} from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { backTrail, stageItems } from "../../run-block/lib/block-view";
import { OutputView } from "../../shared/components/OutputView";
import { StageStrip } from "../../shared/components/StageStrip";
import { TaskPanel } from "../../shared/components/TaskPanel";
import {
  groupBySteps,
  groupRound,
  groupTasksByStep,
  showSteps,
  stepOfStages,
} from "../../shared/lib/steps";
import { pendingDecisionTask } from "../../shared/lib/thread-task";
import { BackTimeline } from "./BackTimeline";
import { StageOutputs } from "./StageOutputs";
import { StageRow } from "./StageRow";
import { StepSection } from "./StepSection";
import { TaskAccessBanner } from "./TaskAccessBanner";

export function ProgressTab({ view }: { view: ProcessRunView }) {
  return view.access === "full" ? <FullProgress view={view} /> : <TaskProgress view={view} />;
}

function FullProgress({ view }: { view: ProcessRunFullView }) {
  // E-P7: admin quyết được nhưng không là assignee ⇒ my_tasks rỗng; dựng thẻ "Cần người quyết" từ view.decision.
  const decision = pendingDecisionTask(view);
  return (
    <div className="flex flex-col gap-4 p-4">
      <StageStrip stages={stageItems(view)} back={backTrail(view)} />
      {showSteps(view.stages) ? (
        <StepSections view={view} />
      ) : (
        <>
          {/* Run tuyến tính: ghi chú tri thức theo từng giai đoạn (HUB-FR-134, UAT M1) */}
          {view.stages
            .filter((s) => s.knowledge)
            .map((s) => (
              <StageRow key={`kn-${s.idx}`} stage={s} />
            ))}
          {view.stages
            .filter((s) => s.outputs.length > 0)
            .map((s) => (
              <StageOutputs key={s.idx} runId={view.id} stage={s} />
            ))}
          {view.my_tasks.map((task) => (
            <TaskPanel key={task.id} runId={view.id} task={task} view={view} />
          ))}
        </>
      )}
      <BackTimeline events={view.back_events ?? []} stages={view.stages} />
      {decision && <TaskPanel key={decision.id} runId={view.id} task={decision} view={view} />}
    </div>
  );
}

/** Có bước song song / đã quay lại: mỗi bước một `group` "Bước n" (+ ×lần) gồm dòng giai đoạn, kết quả, thẻ việc của bước. */
function StepSections({ view }: { view: ProcessRunFullView }) {
  const stepOf = stepOfStages(view.stages);
  return groupBySteps(view.stages).map((g) => (
    <StepSection key={g.step} step={g.step} round={groupRound(g)}>
      {g.items.map((s) => (
        <div key={s.idx} className="flex flex-col gap-2">
          <StageRow stage={s} />
          {s.outputs.length > 0 && <StageOutputs runId={view.id} stage={s} />}
        </div>
      ))}
      {view.my_tasks
        .filter((x) => stepOf.get(x.stage_idx) === g.step)
        .map((task) => (
          <TaskPanel key={task.id} runId={view.id} task={task} view={view} />
        ))}
    </StepSection>
  ));
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

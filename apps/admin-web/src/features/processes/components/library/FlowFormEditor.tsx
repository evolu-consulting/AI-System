// CR-105 · L3: Form = editor bước tuần tự của khe `contracts.approval` (chuyển từ contracts-web `FlowPane`). Lưu ghi `slot_body`.
// CR-121 D-3: theo khuôn mockup — đầu trang (Loại + nguồn + phiên bản), thanh trạng thái, bộ đếm n/20, nút thêm bước chỉ icon theo
// `nodes` của khe. Công tắc Danh sách | Sơ đồ = "Cách xem" của thanh công cụ (Sơ đồ = Canvas flow-canvas hiện có): không dựng control thứ hai.
// Thân không biểu diễn được bằng Form (song song, nhánh…) ⇒ chỉ xem + "Sửa ở Canvas".
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFlowForm } from "../../hooks/use-flow-form";
import { saveModeOf } from "../../lib/company-copy";
import { FLOW_MAX_STEPS } from "../../lib/flow-form";
import { DEFAULT_FIELDS } from "../../lib/flow-when";
import type { PublishIssue } from "../../lib/publish-issues";
import { canAddStep, stepCounter } from "../../lib/step-limit";
import type { LibraryDef, SlotInfo } from "../../library-api";
import { FlowAddNodes } from "./FlowAddNodes";
import { type BarIssue, FlowFormHeader, FlowStatusBar, issueText } from "./FlowStatusBar";
import { FlowStepCard } from "./FlowStepCard";

type Props = {
  def: LibraryDef;
  slot: SlotInfo | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onToCanvas: () => void;
  /** c17b · bản riêng của công ty: cùng Form, lưu thẳng (áp dụng ngay), không ghi "Nháp/Xuất bản". */
  companyCopy?: boolean;
  /** Lỗi xuất bản gần nhất từ Hub (422: bước, trường, câu sửa). */
  publishIssues?: readonly PublishIssue[];
};

/** Nhảy tới bước (bấm lỗi ở thanh trạng thái): cuộn vào giữa + đưa focus vào ô đầu tiên của bước. */
function jumpToStep(index: number): void {
  const el = document.getElementById(`flow-step-${index}`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.querySelector<HTMLElement>("input, button[role=combobox]")?.focus({ preventScroll: true });
}

export function FlowFormEditor({
  def,
  slot,
  onDirtyChange,
  onToCanvas,
  companyCopy = false,
  publishIssues = [],
}: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  const fields = slot?.fields && slot.fields.length > 0 ? slot.fields : DEFAULT_FIELDS;
  const form = useFlowForm(def, onDirtyChange, fields);
  const { steps, dispatch, issues } = form;
  if (!form.canEdit)
    return (
      <Alert className="flex items-center gap-3" data-testid="flow-form-unsupported">
        <AlertDescription className="flex-1">{f("unsupported")}</AlertDescription>
        <Button type="button" variant="outline" onClick={onToCanvas}>
          {f("toCanvas")}
        </Button>
      </Alert>
    );
  const groups = slot?.group_keys ?? [];
  const general = issues.filter((i) => i.index === null);
  const full = !canAddStep(steps.length);
  const barIssues: BarIssue[] = [
    ...issues.map((i) => ({ index: i.index, text: issueText(t, i.index, i.code) })),
    ...publishIssues.map((i) => ({
      index: i.index,
      text: i.index === null ? i.text : f("stepIssue", { n: i.index + 1, msg: i.text }),
    })),
  ].filter((x, k, a) => a.findIndex((y) => y.index === x.index && y.text === x.text) === k);
  return (
    <div className="space-y-4" data-testid="flow-form">
      <FlowFormHeader def={def} companyCopy={companyCopy} />
      <FlowStatusBar
        def={def}
        companyCopy={companyCopy}
        dirty={form.dirty}
        issues={barIssues}
        onJump={jumpToStep}
      />
      <p className="text-body text-muted-foreground">{f("lead")}</p>
      <section
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-label"
        data-testid="flow-form-rules"
        aria-label={f("rules.title")}
      >
        <h3 className="mb-1 font-semibold">{f("rules.title")}</h3>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          <li>{f("rules.owner")}</li>
          <li>{f("rules.escalate")}</li>
        </ul>
      </section>
      <div className="flex items-center gap-2">
        <h3 className="text-label font-medium text-muted-foreground">{f("steps")}</h3>
        <span
          className="font-mono text-caption text-muted-foreground"
          data-testid="flow-counter"
          title={f("counterHint", { max: FLOW_MAX_STEPS })}
        >
          {stepCounter(steps.length)}
        </span>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <FlowStepCard
            key={s.key}
            step={s}
            index={i}
            count={steps.length}
            groups={groups}
            fields={fields}
            issues={issues}
            editable
            onPatch={(patch) => dispatch({ type: "patch", index: i, patch })}
            onWhen={(when) => dispatch({ type: "setWhen", index: i, when })}
            onMove={(dir) => dispatch({ type: "move", index: i, dir })}
            onRemove={() => dispatch({ type: "remove", index: i })}
          />
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <FlowAddNodes
          nodes={slot?.nodes}
          full={full}
          hasEsign={steps.some((s) => s.kind === "esign")}
          onAdd={(kind) =>
            dispatch(
              kind === "review"
                ? { type: "addReview" }
                : kind === "notify"
                  ? { type: "addNotify", name: f("notify.defaultName") }
                  : kind === "wait_until"
                    ? { type: "addWait", name: f("wait.defaultName") }
                    : { type: "addEsign", name: f("esign.defaultName") },
            )
          }
        />
        {full ? (
          <span className="text-caption text-muted-foreground">{f("maxReached")}</span>
        ) : null}
      </div>
      {general.map((g) => (
        <p key={`${g.field}${g.code}`} role="alert" className="text-label text-destructive">
          {f(`err.${g.code}`)}
        </p>
      ))}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div
          className="min-w-0 flex-1 text-label text-muted-foreground"
          data-testid="copy-save-note"
        >
          {companyCopy ? t("process.admin.editor.applyNote") : null}
        </div>
        <Button type="button" variant="outline" disabled={!form.dirty} onClick={form.discard}>
          {f("discard")}
        </Button>
        <Button
          type="button"
          disabled={!form.dirty || issues.length > 0}
          onClick={() => void form.save(steps)}
        >
          {t(saveModeOf(companyCopy, !companyCopy).labelKey)}
        </Button>
      </div>
      <LazyConflictDialog props={form.conflictProps} />
    </div>
  );
}

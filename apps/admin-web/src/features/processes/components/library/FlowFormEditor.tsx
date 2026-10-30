// CR-105 · L3: Form = editor bước tuần tự của khe `contracts.approval` (chuyển từ contracts-web `FlowPane`). Lưu ghi `slot_body`.
// Thân không biểu diễn được bằng Form (song song, nhánh…) ⇒ chỉ xem + "Sửa ở Canvas".
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFlowForm } from "../../hooks/use-flow-form";
import { FLOW_MAX_STEPS } from "../../lib/flow-form";
import type { LibraryDef, SlotInfo } from "../../library-api";
import { FlowStepCard } from "./FlowStepCard";

type Props = {
  def: LibraryDef;
  slot: SlotInfo | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onToCanvas: () => void;
};

export function FlowFormEditor({ def, slot, onDirtyChange, onToCanvas }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.form.${k}`);
  const form = useFlowForm(def, onDirtyChange);
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
  const full = steps.length >= FLOW_MAX_STEPS;
  return (
    <div className="space-y-4" data-testid="flow-form">
      <p className="text-body text-muted-foreground">{f("lead")}</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <FlowStepCard
            key={s.key}
            step={s}
            index={i}
            count={steps.length}
            groups={groups}
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
        <Button
          type="button"
          variant="outline"
          disabled={full}
          onClick={() => dispatch({ type: "addReview" })}
        >
          {f("addStep")}
        </Button>
        {steps.some((s) => s.kind === "esign") ? null : (
          <Button
            type="button"
            variant="outline"
            disabled={full}
            onClick={() => dispatch({ type: "addEsign", name: f("esign.defaultName") })}
          >
            {f("addEsign")}
          </Button>
        )}
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
        <div className="min-w-0 flex-1 text-label text-muted-foreground">
          {form.dirty ? t("common.unsaved") : t("common.savedVersion", { n: def.version })}
        </div>
        <Button type="button" variant="outline" disabled={!form.dirty} onClick={form.discard}>
          {f("discard")}
        </Button>
        <Button
          type="button"
          disabled={!form.dirty || issues.length > 0}
          onClick={() => void form.save(steps)}
        >
          {t("common.save")}
        </Button>
      </div>
      <LazyConflictDialog props={form.conflictProps} />
    </div>
  );
}

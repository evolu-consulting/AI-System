// CR-122 · U1 · FLOW2-FR-02/15/16: thân MỘT trình sửa flow cho Thư viện lẫn bản công ty — node Bắt đầu khi ở đầu, bảng node theo
// manifest + canvas (children), lỗi theo `flowDefIssues`. Canvas mặc định; trigger giữ ở state của trang (gửi kèm khi Lưu).
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DefDraft, toInput } from "../../lib/def-form";
import type { StageDraft } from "../../lib/draft-types";
import { whenSummary } from "../../lib/fact-when";
import {
  eventOf,
  type FlowMeta,
  retargetEvent,
  toFlowDef,
  validateFlowDef,
} from "../../lib/flow-def";
import { edgeProblems } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { BridgeIssues } from "./BridgeIssues";
import { OP_SYMBOL } from "./FactWhenEditor";
import { FlowContext } from "./flow-ctx";
import { TriggerCard } from "./TriggerCard";

type Props = {
  meta: Omit<FlowMeta, "trigger">;
  trigger: FlowTrigger;
  stages: readonly StageDraft[];
  readOnly: boolean;
  /** Công ty để lọc bảng node theo tính năng đang bật (vắng ⇒ mọi node). */
  tenantId?: string | undefined;
  /** Bản nháp đầy đủ (gửi cho gợi ý cầu nối). */
  draft: DefDraft;
  onChange: (trigger: FlowTrigger, stages?: StageDraft[]) => void;
  children: ReactNode;
};

export function FlowEditorBody({
  meta,
  trigger,
  stages,
  readOnly,
  tenantId,
  draft,
  onChange,
  children,
}: Props) {
  const { t } = useTranslation();
  const palette = usePalette(meta.app, tenantId);
  const problems = useMemo(() => edgeProblems(stages, palette.data ?? []), [stages, palette.data]);
  const issues = useMemo(
    () => validateFlowDef(toFlowDef(stages, { ...meta, trigger }), meta.app),
    [stages, meta, trigger],
  );
  const event = eventOf(meta.app, trigger.event);
  const whenErr = issues.find((i) => i.path.startsWith("trigger"));
  const others = issues.filter((i) => !i.path.startsWith("trigger"));
  const onEvent = (key: string) => {
    const next = eventOf(meta.app, key);
    if (!next) return;
    const r = retargetEvent(trigger, stages, next);
    onChange(r.trigger, r.stages);
  };
  const [open, setOpen] = useState(false);
  const summary = whenSummary(trigger.when, event?.facts ?? [], (o) => OP_SYMBOL[o], {
    and: t("process.admin.flow.and").toLowerCase(),
    or: t("process.admin.flow.or").toLowerCase(),
  });
  const ctx = {
    app: meta.app,
    tenantId,
    event,
    warnEdges: problems.map((x) => ({ from: x.from, to: x.to })),
    trigger: { label: event?.label ?? trigger.event, summary, onOpen: () => setOpen((o) => !o) },
  };
  return (
    <FlowContext.Provider value={ctx}>
      <div className="space-y-4" data-testid="flow-editor">
        {open || whenErr ? (
          <TriggerCard
            app={meta.app}
            trigger={trigger}
            readOnly={readOnly}
            onEvent={onEvent}
            onWhen={(when) => {
              const { when: _w, ...rest } = trigger;
              onChange(when ? { ...rest, when } : rest);
            }}
            error={whenErr ? t(`process.admin.flow.err.${whenErr.key}`) : undefined}
          />
        ) : null}
        {others.length > 0 && !readOnly ? (
          <ul className="space-y-1" role="alert" data-testid="flow-issues">
            {[...new Set(others.map((i) => i.key))].map((k) => (
              <li key={k} className="text-caption text-destructive">
                {t(`process.admin.flow.err.${k}`)}
              </li>
            ))}
          </ul>
        ) : null}
        <BridgeIssues
          problems={problems}
          stages={stages}
          toDef={() => toInput(draft)}
          readOnly={readOnly}
          onStages={(next) => onChange(trigger, next)}
        />
        {children}
      </div>
    </FlowContext.Provider>
  );
}

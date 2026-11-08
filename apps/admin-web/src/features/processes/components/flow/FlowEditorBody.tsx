// CR-122 · U1 · FLOW2-FR-02/15/16: thân MỘT trình sửa flow cho Thư viện lẫn bản công ty — node Bắt đầu khi ở đầu, bảng node theo
// manifest + canvas (children), lỗi theo `flowDefIssues`. Canvas mặc định; trigger giữ ở state của trang (gửi kèm khi Lưu).

import { startOutputsOf } from "@ai/contracts/app-manifest";
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBridge } from "../../hooks/use-bridge";
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
import { edgeProblems, groupProblems } from "../../lib/palette-node";
import {
  addStartFormFirst,
  freshStartStage,
  hasStartForm,
  removeStartForm,
} from "../../lib/start-form-ops";
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
  const event = eventOf(meta.app, trigger.event);
  const start = useMemo(() => startOutputsOf(event), [event]);
  const problems = useMemo(
    () => edgeProblems(stages, palette.data ?? [], start),
    [stages, palette.data, start],
  );
  const issues = useMemo(
    () => validateFlowDef(toFlowDef(stages, { ...meta, trigger }), meta.app),
    [stages, meta, trigger],
  );
  const whenErr = issues.find((i) => i.path.startsWith("trigger"));
  const others = issues.filter((i) => !i.path.startsWith("trigger"));
  const onEvent = (key: string) => {
    const next = eventOf(meta.app, key);
    if (!next) return;
    const r = retargetEvent(trigger, stages, next);
    onChange(r.trigger, r.stages);
  };
  const groups = useMemo(
    () => groupProblems(problems, (uid) => stages.find((s) => s.uid === uid)?.name ?? ""),
    [problems, stages],
  );
  const bridge = useBridge({
    stages,
    toDef: () => toInput(draft),
    onStages: (next) => onChange(trigger, next),
  });
  const [open, setOpen] = useState(false);
  const [startErr, setStartErr] = useState<string | undefined>(undefined);
  const onStartForm = (on: boolean) => {
    setStartErr(undefined);
    if (!on) return onChange(trigger, removeStartForm(stages));
    const r = addStartFormFirst(
      stages,
      freshStartStage({
        name: t("process.admin.startForm.nodeName"),
        fieldLabel: t("process.admin.startForm.newField", { n: 1 }),
        flowName: draft.name,
      }),
    );
    if ("error" in r) return setStartErr(t(r.error));
    onChange(trigger, r.stages);
  };
  const selectRef = useRef<((uid: string) => void) | null>(null);
  const summary = whenSummary(
    trigger.when,
    event?.facts ?? [],
    (o) => OP_SYMBOL[o],
    {
      and: t("process.admin.flow.and").toLowerCase(),
      or: t("process.admin.flow.or").toLowerCase(),
    },
    {
      is: t("process.admin.editor.stage.if.opIs"),
      isNot: t("process.admin.editor.stage.if.opIsNot"),
      yes: t("process.admin.flow.yes"),
      no: t("process.admin.flow.no"),
    },
  );
  const ctx = {
    app: meta.app,
    tenantId,
    event,
    warnEdges: groups,
    bridge,
    stepName: (n: number) => stages.find((s) => s.step === n)?.name ?? `${n + 1}`,
    selectRef,
    nodeKeys: stages.flatMap((s) => (s.node ? [s.node] : [])),
    patchStage: (uid: string, patch: Partial<StageDraft>) =>
      onChange(
        trigger,
        stages.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
      ),
    patchStages: (items: readonly { uid: string; patch: Partial<StageDraft> }[]) =>
      onChange(
        trigger,
        stages.map((s) => {
          const it = items.find((x) => x.uid === s.uid);
          return it ? { ...s, ...it.patch } : s;
        }),
      ),
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
            startForm={{ on: hasStartForm(stages), onChange: onStartForm, error: startErr }}
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
        <BridgeIssues groups={groups} onSelect={(uid) => selectRef.current?.(uid)} />
        {children}
      </div>
    </FlowContext.Provider>
  );
}

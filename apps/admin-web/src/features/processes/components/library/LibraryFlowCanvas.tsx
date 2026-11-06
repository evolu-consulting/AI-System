// CR-122 · canvas CHỈ ĐỌC của flow Thư viện theo sự kiện (node "Bắt đầu khi" + các bước) — cùng ProcessCanvas với trình sửa.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEditorRefs } from "../../hooks/use-editor-refs";
import type { StageOps } from "../../hooks/use-stage-ops";
import { whenSummary } from "../../lib/fact-when";
import { eventOf } from "../../lib/flow-def";
import type { LibraryFlow } from "../../lib/library-flow";
import { CanvasView } from "../canvas/CanvasView";
import { stageViews } from "../canvas/stage-view";
import { OP_SYMBOL } from "../flow/FactWhenEditor";
import { FlowContext } from "../flow/flow-ctx";

const NOOP_OPS = new Proxy({}, { get: () => () => undefined }) as StageOps;
const noop = () => undefined;

export function LibraryFlowCanvas({ flow, tenantId }: { flow: LibraryFlow; tenantId: string }) {
  const { t } = useTranslation();
  const refs = useEditorRefs(tenantId, true);
  const stages = flow.draft.stages;
  const views = useMemo(() => stageViews(stages, {}, refs), [stages, refs]);
  const event = eventOf(flow.app, flow.trigger.event);
  const summary = whenSummary(flow.trigger.when, event?.facts ?? [], (o) => OP_SYMBOL[o], {
    and: t("process.admin.flow.and").toLowerCase(),
    or: t("process.admin.flow.or").toLowerCase(),
  });
  const ctx = {
    app: flow.app,
    tenantId,
    event,
    stepName: (n: number) => stages.find((s) => s.step === n)?.name ?? `${n + 1}`,
    trigger: { label: event?.label ?? flow.trigger.event, summary, onOpen: noop },
  };
  return (
    <FlowContext.Provider value={ctx}>
      <div data-testid="library-flow-canvas">
        <CanvasView
          views={views}
          selected={undefined}
          readOnly
          ops={NOOP_OPS}
          onSelect={noop}
          onRemove={noop}
        />
      </div>
    </FlowContext.Provider>
  );
}

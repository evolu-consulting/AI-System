// CR-122 · U1 · FLOW2-FR-02/15/16: thân MỘT trình sửa flow cho Thư viện lẫn bản công ty — node Bắt đầu khi ở đầu, bảng node theo
// manifest + canvas (children), lỗi theo `flowDefIssues`. Canvas mặc định; trigger giữ ở state của trang (gửi kèm khi Lưu).
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { StageDraft } from "../../lib/draft-types";
import {
  eventOf,
  type FlowMeta,
  retargetEvent,
  toFlowDef,
  validateFlowDef,
} from "../../lib/flow-def";
import { FlowContext } from "./flow-ctx";
import { TriggerCard } from "./TriggerCard";

type Props = {
  meta: Omit<FlowMeta, "trigger">;
  trigger: FlowTrigger;
  stages: readonly StageDraft[];
  readOnly: boolean;
  onChange: (trigger: FlowTrigger, stages?: StageDraft[]) => void;
  children: ReactNode;
};

export function FlowEditorBody({ meta, trigger, stages, readOnly, onChange, children }: Props) {
  const { t } = useTranslation();
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
  return (
    <FlowContext.Provider value={{ app: meta.app, event }}>
      <div className="space-y-4" data-testid="flow-editor">
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
        {others.length > 0 && !readOnly ? (
          <ul className="space-y-1" role="alert" data-testid="flow-issues">
            {[...new Set(others.map((i) => i.key))].map((k) => (
              <li key={k} className="text-caption text-destructive">
                {t(`process.admin.flow.err.${k}`)}
              </li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
    </FlowContext.Provider>
  );
}

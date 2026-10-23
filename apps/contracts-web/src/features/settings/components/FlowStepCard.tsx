// contract-flow S5 · một bước của mẫu luồng: bước duyệt (phòng, trưởng phòng, hạn, nhắc, chuyển cấp, điều kiện) hoặc bước Dify.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { FlowStep, ReviewStep } from "../api-flow";
import { type FlowIssue, issueOf, REMIND_MAX, REMIND_MIN } from "../lib/flow-state";
import { FIELD } from "./controls";
import { FlowWhen } from "./FlowWhen";

export type Dept = { id: string; name: string };
const BTN = "h-8 rounded-lg border border-rule px-2 text-label hover:bg-sunk disabled:opacity-40";

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-dim">{label}</span>
      {children}
      {error && (
        <span role="alert" className="text-caption text-late">
          {error}
        </span>
      )}
    </div>
  );
}

type Props = {
  step: FlowStep;
  index: number;
  count: number;
  depts: Dept[];
  issues: FlowIssue[];
  editable: boolean;
  onPatch: (p: Partial<ReviewStep>) => void;
  onWhen: (w: ReviewStep["when"]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

export function FlowStepCard(p: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) => t(`contracts.flow.${k}`, o);
  const { step, index } = p;
  const err = (field: string) => {
    const i = issueOf(p.issues, index, field);
    return i ? (i.message ?? f(`err.${i.code}`, { min: REMIND_MIN, max: REMIND_MAX })) : undefined;
  };
  const first = index === 0;
  const deptOpts = (cur: string) =>
    p.depts.some((d) => d.id === cur) || !cur ? p.depts : [...p.depts, { id: cur, name: cur }];

  return (
    <li className="rounded-xl border border-rule bg-panel p-4" data-testid={`flow-step-${index}`}>
      <div className="mb-3 flex items-center gap-2">
        <b className="text-label">
          {index + 1}.{" "}
          {first ? f("firstName") : step.kind === "dify" ? f("difyStep") : f("reviewStep")}
        </b>
        {p.editable && !first && (
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              className={BTN}
              disabled={index <= 1}
              aria-label={f("up")}
              onClick={() => p.onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={BTN}
              disabled={index >= p.count - 1}
              aria-label={f("down")}
              onClick={() => p.onMove(1)}
            >
              ↓
            </button>
            <button type="button" className={BTN} aria-label={f("remove")} onClick={p.onRemove}>
              {f("remove")}
            </button>
          </span>
        )}
      </div>
      {step.kind === "dify" ? (
        <p className="text-dim">{f("difyInfo", { name: step.name || step.workflow_key })}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label={f("name")} error={err("name")}>
            <input
              className={FIELD}
              value={step.name}
              onChange={(e) => p.onPatch({ name: e.target.value })}
            />
          </Field>
          <Field label={f("dept")} error={err("department_group_id")}>
            <select
              className={FIELD}
              value={step.department_group_id}
              onChange={(e) => p.onPatch({ department_group_id: e.target.value })}
            >
              <option value="">{f("pick")}</option>
              {deptOpts(step.department_group_id).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={f("dueH")} error={err("due_h")}>
            <input
              type="number"
              min={1}
              className={FIELD}
              value={step.due_h}
              onChange={(e) => p.onPatch({ due_h: Number(e.target.value) })}
            />
          </Field>
          <Field
            label={f("remindH", { min: REMIND_MIN, max: REMIND_MAX })}
            error={err("remind_every_h")}
          >
            <input
              type="number"
              className={FIELD}
              placeholder={f("none")}
              value={step.remind_every_h ?? ""}
              onChange={(e) =>
                p.onPatch({ remind_every_h: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
          <Field label={f("escalate")} error={err("escalate_group_id")}>
            <select
              className={FIELD}
              value={step.escalate_group_id ?? ""}
              onChange={(e) => p.onPatch({ escalate_group_id: e.target.value || null })}
            >
              <option value="">{f("none")}</option>
              {deptOpts(step.escalate_group_id ?? "")
                .filter((d) => d.id !== step.department_group_id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={step.head_only}
                onChange={(e) => p.onPatch({ head_only: e.target.checked })}
              />
              {f("headOnly")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={step.exclude_starter}
                onChange={(e) => p.onPatch({ exclude_starter: e.target.checked })}
              />
              {f("excludeStarter")}
            </label>
          </div>
          <div className="col-span-2 max-md:col-span-1">
            <Field label={f("cond")}>
              {first ? (
                <span className="text-dim">{f("firstNoCond")}</span>
              ) : (
                <FlowWhen when={step.when} onChange={p.onWhen} error={err("when")} />
              )}
            </Field>
          </div>
        </div>
      )}
    </li>
  );
}

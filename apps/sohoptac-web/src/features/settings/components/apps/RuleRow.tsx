// CR-118 §11.2 · một dòng luật: thứ tự (lên/xuống), phòng ban (nhiều), quy trình (chỉ trong số đã gán), mặc định, xoá.
import type { AssignedProcess } from "@ai/contracts/hub-admin";
import type { RuleDraft, RuleIssueCode } from "@ai/web-kit/routing-rules";
import { useTranslation } from "react-i18next";
import { FIELD } from "../controls";
import { type Dept, DeptPicker } from "./DeptPicker";

export type RuleRowProps = {
  rule: RuleDraft;
  index: number;
  total: number;
  processes: readonly AssignedProcess[];
  departments: readonly Dept[];
  issue?: RuleIssueCode;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onProcess: (defId: string) => void;
  onToggleDept: (deptId: string) => void;
  onDefault: (on: boolean) => void;
};

const BTN = "rounded-md border border-rule px-2 py-1 text-caption disabled:opacity-40";

export function RuleRow(p: RuleRowProps) {
  const { t } = useTranslation();
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  const id = `routing-rule-${p.index}`;
  return (
    <li
      data-testid={id}
      className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-rule bg-panel p-3 max-md:grid-cols-1"
    >
      <div className="flex items-center gap-1">
        <b className="mr-1 text-label">{t("contracts.settings.apps.rule.n", { n: p.index + 1 })}</b>
        <button
          type="button"
          className={BTN}
          aria-label={a("rule.up")}
          disabled={p.disabled || p.index === 0}
          onClick={() => p.onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className={BTN}
          aria-label={a("rule.down")}
          disabled={p.disabled || p.index === p.total - 1}
          onClick={() => p.onMove(1)}
        >
          ↓
        </button>
      </div>
      {p.rule.isDefault ? (
        <p className="self-center text-body text-dim">{a("rule.defaultCond")}</p>
      ) : (
        <DeptPicker
          testId={`${id}-depts`}
          value={p.rule.departmentIds}
          departments={p.departments}
          disabled={p.disabled}
          onToggle={p.onToggleDept}
        />
      )}
      <select
        data-testid={`${id}-process`}
        aria-label={a("rule.process")}
        className={FIELD}
        value={p.rule.defId}
        disabled={p.disabled}
        onChange={(e) => p.onProcess(e.target.value)}
      >
        {!p.processes.some((x) => x.def_id === p.rule.defId) && (
          <option value={p.rule.defId}>{a("rule.unassigned")}</option>
        )}
        {p.processes.map((x) => (
          <option key={x.def_id} value={x.def_id}>
            {x.name}
            {x.rel_version !== null ? ` · v${x.rel_version}` : ""}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-label">
          <input
            type="checkbox"
            data-testid={`${id}-default`}
            checked={p.rule.isDefault}
            disabled={p.disabled}
            onChange={(e) => p.onDefault(e.target.checked)}
          />
          {a("rule.default")}
        </label>
        <button
          type="button"
          data-testid={`${id}-remove`}
          className={`${BTN} text-late`}
          disabled={p.disabled}
          onClick={p.onRemove}
        >
          {a("rule.remove")}
        </button>
      </div>
      {p.issue && (
        <p role="alert" className="col-span-full text-caption text-late">
          {a(`issue.${p.issue}`)}
        </p>
      )}
    </li>
  );
}

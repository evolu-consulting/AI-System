// CR-118 §11.2 · bộ sửa luật chọn quy trình theo phòng ban của một tenant × khe (platform_admin; logic dùng chung `@ai/web-kit/routing-rules`).
// Bản của sohoptac-web (Cài đặt) là bản nhỏ trùng chức năng nhưng dùng token/shadcn riêng của app đó.
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import {
  addRule,
  canAddRule,
  fromServer,
  moveRule,
  newRuleKey,
  patchRule,
  type RoutingErrorSpec,
  type RuleDraft,
  removeRule,
  ruleIssues,
  sameRules,
  setDefault,
  toggleDepartment,
} from "@ai/web-kit/routing-rules";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { useSlotRoutingActions } from "../../hooks/use-slot-routing";

type Dept = { id: string; name: string };
const SEL = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-body";

function Row(p: {
  r: RuleDraft;
  i: number;
  n: number;
  data: ProcessRouting;
  depts: readonly Dept[];
  bad?: string;
  busy: boolean;
  set: (f: (l: RuleDraft[]) => RuleDraft[]) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string) => t(`tenants.slots.routing.${s}`);
  const { r, i, set, busy } = p;
  return (
    <li
      data-testid={`admin-routing-rule-${i}`}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-label">{t("tenants.slots.routing.rule", { n: i + 1 })}</b>
        <Button
          size="sm"
          variant="outline"
          aria-label={k("up")}
          disabled={busy || i === 0}
          onClick={() => set((l) => moveRule(l, r.key, -1))}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={k("down")}
          disabled={busy || i === p.n - 1}
          onClick={() => set((l) => moveRule(l, r.key, 1))}
        >
          ↓
        </Button>
        <select
          aria-label={k("process")}
          data-testid={`admin-routing-rule-${i}-process`}
          className={SEL}
          value={r.defId}
          disabled={busy}
          onChange={(e) => set((l) => patchRule(l, r.key, { defId: e.target.value }))}
        >
          {!p.data.processes.some((x) => x.def_id === r.defId) && (
            <option value={r.defId}>{k("unassigned")}</option>
          )}
          {p.data.processes.map((x) => (
            <option key={x.def_id} value={x.def_id}>
              {x.name}
              {x.rel_version !== null ? ` · v${x.rel_version}` : ""}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-label">
          <input
            type="checkbox"
            checked={r.isDefault}
            disabled={busy}
            onChange={(e) => set((l) => setDefault(l, r.key, e.target.checked))}
          />
          {k("default")}
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => set((l) => removeRule(l, r.key))}
        >
          {k("remove")}
        </Button>
      </div>
      {r.isDefault ? (
        <p className="text-caption text-muted-foreground">{k("defaultCond")}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {p.depts.length === 0 && (
            <li className="text-caption text-muted-foreground">{k("noDepartments")}</li>
          )}
          {p.depts.map((d) => (
            <li key={d.id}>
              <label className="flex items-center gap-1 text-body">
                <input
                  type="checkbox"
                  checked={r.departmentIds.includes(d.id)}
                  disabled={busy}
                  onChange={() => set((l) => toggleDepartment(l, r.key, d.id))}
                />
                {d.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {r.unavailable && (
        <p
          data-testid={`admin-routing-rule-${i}-unavailable`}
          className="w-fit rounded-full bg-destructive/10 px-2.5 py-0.5 text-caption font-semibold text-destructive"
        >
          {k(r.unavailable === "deleted" ? "unavailableDeleted" : "unavailableUnpublished")}
        </p>
      )}
      {p.bad && (
        <p role="alert" className="text-caption text-destructive">
          {k(`issue.${p.bad}`)}
        </p>
      )}
    </li>
  );
}

export function RoutingRules({
  tenantId,
  slot,
  data,
  departments,
  onReload,
}: {
  tenantId: string;
  slot: string;
  data: ProcessRouting;
  departments: readonly Dept[];
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const k = (s: string) => t(`tenants.slots.routing.${s}`);
  const act = useSlotRoutingActions(tenantId, slot);
  const base = useMemo(() => fromServer(data.rules), [data.rules]);
  const [rules, setRules] = useState(base);
  const [err, setErr] = useState<RoutingErrorSpec | null>(null);
  const issues = ruleIssues(
    rules,
    new Set(data.processes.map((p) => p.def_id)),
    new Set(departments.map((d) => d.id)),
  );
  const dirty = !sameRules(rules, base);
  const first = data.processes[0]?.def_id;
  const set = (f: (l: RuleDraft[]) => RuleDraft[]) => {
    setRules(f);
    setErr(null);
  };
  const save = async () => {
    const r = await act.save(data.version, rules);
    if (r.ok) notifySuccess(k("saved"));
    else setErr(r.spec);
  };
  return (
    <div data-testid={`admin-routing-${slot}`} className="space-y-2">
      <p className="text-caption text-muted-foreground">
        {k("rulesLead")} {k("subDeptNote")}
      </p>
      {rules.length === 0 && <p className="text-body text-muted-foreground">{k("noRules")}</p>}
      <ol className="space-y-2">
        {rules.map((r, i) => (
          <Row
            key={r.key}
            r={r}
            i={i}
            n={rules.length}
            data={data}
            depts={departments}
            bad={issues.find((x) => x.key === r.key)?.code}
            busy={act.pending}
            set={set}
          />
        ))}
      </ol>
      {err && (
        <p role="alert" data-testid="admin-routing-error" className="text-body text-destructive">
          {k(`err.${err.kind}`)}{" "}
          {err.kind === "conflict" && (
            <button type="button" className="underline" onClick={onReload}>
              {k("reload")}
            </button>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="admin-routing-add"
          disabled={act.pending || !first || !canAddRule(rules)}
          onClick={() => first && set((l) => addRule(l, first, newRuleKey()))}
        >
          {k("addRule")}
        </Button>
        <Button
          size="sm"
          data-testid="admin-routing-save"
          disabled={act.pending || !dirty || issues.length > 0}
          onClick={() => void save()}
        >
          {k("save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={act.pending || !dirty}
          onClick={() => set(() => base)}
        >
          {k("discard")}
        </Button>
      </div>
    </div>
  );
}

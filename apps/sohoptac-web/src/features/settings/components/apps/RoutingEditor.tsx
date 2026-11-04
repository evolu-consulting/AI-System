// CR-118 §11.2 · bộ sửa luật chọn quy trình của MỘT khe: thêm/xoá/đổi thứ tự luật, chọn phòng ban, quy trình (trong số đã gán),
// mặc định; lưu cả danh sách một lần (`version` chống ghi đè). Bản nháp theo `data.version` (remount khi có bản mới).
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import {
  addRule,
  canAddRule,
  fromServer,
  moveRule,
  newRuleKey,
  patchRule,
  type RoutingErrorSpec,
  type RoutingKind,
  removeRule,
  ruleIssues,
  sameRules,
  setDefault,
  slotHasKinds,
  toggleDepartment,
  toggleKind,
} from "@ai/web-kit/routing-rules";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useSaveRouting } from "../../hooks/use-apps-settings";
import type { Dept } from "./DeptPicker";
import { RuleRow } from "./RuleRow";

export function RoutingEditor({
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
  const a = (k: string) => t(`contracts.settings.apps.${k}`);
  const save = useSaveRouting(tenantId, slot);
  const base = useMemo(() => fromServer(data.rules), [data.rules]);
  const [rules, setRules] = useState(base);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<RoutingErrorSpec | null>(null);
  const assigned = useMemo(() => new Set(data.processes.map((p) => p.def_id)), [data.processes]);
  const issues = ruleIssues(rules, assigned, new Set(departments.map((d) => d.id)));
  const dirty = !sameRules(rules, base);
  const first = data.processes[0]?.def_id;
  const kinds = slotHasKinds(slot);

  const edit = (next: typeof rules) => {
    setRules(next);
    setErr(null);
  };
  const onSave = async () => {
    if (issues.length > 0 || busy) return;
    setBusy(true);
    const r = await save(data.version, rules);
    setBusy(false);
    if (r.ok) toast(a("saved"));
    else setErr(r.spec);
  };

  return (
    <div data-testid={`routing-${slot}`} className="mt-3">
      <h4 className="text-label font-semibold">{a("rules")}</h4>
      <p className="mb-2 text-caption text-dim">{a("rulesLead")}</p>
      <p className="mb-3 text-caption text-dim" data-testid="routing-subdept-note">
        {a("subDeptNote")}
      </p>
      {rules.length === 0 && <p className="mb-2 text-body text-dim">{a("noRules")}</p>}
      <ol className="mb-3 flex flex-col gap-2">
        {rules.map((r, i) => (
          <RuleRow
            key={r.key}
            rule={r}
            index={i}
            total={rules.length}
            processes={data.processes}
            departments={departments}
            issue={issues.find((x) => x.key === r.key)?.code}
            disabled={busy}
            onMove={(d) => edit(moveRule(rules, r.key, d))}
            onRemove={() => edit(removeRule(rules, r.key))}
            onProcess={(defId) => edit(patchRule(rules, r.key, { defId }))}
            onToggleDept={(id) => edit(toggleDepartment(rules, r.key, id))}
            {...(kinds
              ? { onToggleKind: (k: RoutingKind) => edit(toggleKind(rules, r.key, k)) }
              : {})}
            onDefault={(on) => edit(setDefault(rules, r.key, on))}
          />
        ))}
      </ol>
      {err && (
        <p role="alert" data-testid="routing-error" className="mb-2 text-late">
          {a(`err.${err.kind}`)}{" "}
          {err.kind === "conflict" && (
            <button type="button" className="underline" onClick={onReload}>
              {a("reload")}
            </button>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="routing-add"
          className="rounded-lg border border-rule px-3 py-2 text-label disabled:opacity-40"
          disabled={busy || !first || !canAddRule(rules)}
          onClick={() => first && edit(addRule(rules, first, newRuleKey()))}
        >
          {a("addRule")}
        </button>
        <button
          type="button"
          data-testid="routing-save"
          className="rounded-lg bg-act px-4 py-2 text-label font-semibold text-on-act disabled:opacity-40"
          disabled={busy || !dirty || issues.length > 0}
          onClick={() => void onSave()}
        >
          {busy ? a("saving") : a("save")}
        </button>
        <button
          type="button"
          className="rounded-lg border border-rule px-3 py-2 text-label disabled:opacity-40"
          disabled={busy || !dirty}
          onClick={() => edit(base)}
        >
          {a("discard")}
        </button>
        {!canAddRule(rules) && <span className="text-caption text-dim">{a("tooMany")}</span>}
      </div>
    </div>
  );
}

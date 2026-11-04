// dlc-agent-flows · section "Quy trình DLC" (agent `agentic-cli`, vd dlc-agent): tick tool gói agent được gọi (`pack_tools`)
// và chọn quy trình thư viện (bản đã xuất bản) dùng khi agent mở lượt từng dây chuyền (`dlc_flows`; "Theo tenant" = vắng).
// Lưu cùng nút Lưu của form (đi trong `runtime_options`).
import { DLC_FLOW_MODES, type DlcFlowMode } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { DlcFlowSlot, PackToolItem } from "../../hooks/use-dlc-catalogs";
import type { Catalog } from "../../hooks/use-editor-catalogs";
import type { SectionProps } from "../editor/AgentField";

type Props = SectionProps & { tools: Catalog<PackToolItem>; flows: Catalog<DlcFlowSlot> };
const TENANT = "__tenant__";

function PackToolChecks({ draft, set, errors, tools }: Props) {
  const { t } = useTranslation();
  const known = new Set(tools.items.map((x) => x.key));
  // Tool đã gắn mà registry không còn (gói gỡ) vẫn hiện để bỏ tick được.
  const items = [
    ...tools.items.map((x) => ({ key: x.key, gone: false })),
    ...draft.packTools.filter((k) => !known.has(k)).map((k) => ({ key: k, gone: true })),
  ];
  const toggle = (key: string, on: boolean) =>
    set("packTools", on ? [...draft.packTools, key] : draft.packTools.filter((x) => x !== key));
  return (
    <fieldset className="space-y-2" aria-invalid={errors.pack_tools ? true : undefined}>
      <legend className="mb-1 text-label font-medium">{t("agents.dlc.tools")}</legend>
      {tools.failed ? <p className="text-destructive">{t("agents.dlc.toolsFailed")}</p> : null}
      {!tools.pending && items.length === 0 ? (
        <p className="text-muted-foreground">{t("agents.dlc.toolsEmpty")}</p>
      ) : null}
      {items.map((x) => (
        <div key={x.key} className="flex items-start gap-2">
          <Checkbox
            id={`pack-tool-${x.key}`}
            checked={draft.packTools.includes(x.key)}
            onCheckedChange={(v) => toggle(x.key, v === true)}
          />
          <Label htmlFor={`pack-tool-${x.key}`} className="flex flex-col items-start gap-0.5">
            <span>{t(`agents.dlc.tool.${x.key}`, { defaultValue: x.key })}</span>
            <span className="font-mono text-caption text-muted-foreground">
              {x.gone ? t("agents.dlc.toolGone", { key: x.key }) : x.key}
            </span>
          </Label>
        </div>
      ))}
      {errors.pack_tools ? <p className="text-destructive">{t(errors.pack_tools)}</p> : null}
    </fieldset>
  );
}

function FlowSelect({ draft, set, flows, flowMode: mode }: Props & { flowMode: DlcFlowMode }) {
  const { t } = useTranslation();
  const id = `dlc-flow-${mode}`;
  const defs = flows.items.find((s) => s.mode === mode)?.defs ?? [];
  const cur = draft.dlcFlows[mode];
  const pick = (v: string) => {
    const next = { ...draft.dlcFlows };
    if (v === TENANT) delete next[mode];
    else next[mode] = v;
    set("dlcFlows", next);
  };
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[18rem_1fr]">
      <label htmlFor={id} className="text-label">
        {t("agents.dlc.flowFor", { mode: t(`agents.dlc.mode.${mode}`) })}
      </label>
      <Select value={cur ?? TENANT} onValueChange={pick} disabled={flows.pending}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TENANT}>{t("agents.dlc.byTenant")}</SelectItem>
          {defs.map((d) => (
            <SelectItem key={d.key} value={d.key}>
              {d.name} ({d.key})
            </SelectItem>
          ))}
          {cur && !defs.some((d) => d.key === cur) ? (
            <SelectItem value={cur}>{t("agents.dlc.flowGone", { key: cur })}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DlcFlowsSection(p: Props) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="agent-dlc-title"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h3 id="agent-dlc-title" className="text-section-title">
        {t("agents.dlc.title")}
      </h3>
      <p className="text-body text-muted-foreground">{t("agents.dlc.hint")}</p>
      <PackToolChecks {...p} />
      {p.flows.failed ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t("agents.dlc.flowsFailed")}</AlertDescription>
        </Alert>
      ) : null}
      {p.errors.dlc_flows ? (
        <p className="text-destructive" role="alert">
          {t(p.errors.dlc_flows)}
        </p>
      ) : null}
      <div className="space-y-2">
        {DLC_FLOW_MODES.map((m) => (
          <FlowSelect key={m} {...p} flowMode={m} />
        ))}
      </div>
    </section>
  );
}

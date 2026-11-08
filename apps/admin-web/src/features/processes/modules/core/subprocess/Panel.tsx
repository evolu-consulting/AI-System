// CR-125 · cr125-subprocess-ui · panel của node "Quy trình con" (`core.subprocess`), đăng ký ở panelRegistry (không có đường sửa thứ hai):
// chọn quy trình con (ô tìm: tên + trạng thái), xem nó CẦN gì / TRẢ gì, nối đầu vào từ các bước trước (tự nối khi chỉ có một nguồn), mở nó để sửa.
import { startOutputsOf } from "@ai/contracts/app-manifest";
import type { ProcessDef } from "@ai/contracts/hub-admin";
import { autoMapInputs, type MapSource } from "@ai/contracts/modules";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefPicker } from "@/components/shared/RefPicker";
import { useProcessDef } from "../../../api";
import { SelectField } from "../../../components/editor/Fields";
import { useFlowCtx } from "../../../components/flow/flow-ctx";
import { inputSourceType } from "../../../domain/tool-rules";
import { mapSources } from "../../../lib/auto-bind";
import {
  type ChildInput,
  type ChildOption,
  childEditorLink,
  childNeeds,
  childOptions,
  childReturns,
  emptySubprocess,
  SUBPROCESS_NODE,
  type SubprocessDraft,
  unmappedRequired,
  withChild,
  withMapping,
} from "../../../lib/subprocess-form";
import { usePalette } from "../../../palette-api";
import type { NodePanelProps } from "../../panel-registry";
import { useChildDefs } from "./use-child";

const K = "process.admin.subprocess.";
const NONE = "none";

/** Nguồn cha có thể nối vào đầu vào của quy trình con: đầu ra "Bắt đầu khi" + đầu ra các bước trước đã đặt. */
function useSources(): { sources: MapSource[]; labelOf: (id: string) => string } {
  const flow = useFlowCtx();
  const { i18n } = useTranslation();
  const palette = usePalette(flow?.app ?? "", flow?.tenantId);
  const byKey = new Map((palette.data ?? []).map((n) => [n.key, n]));
  const sources = mapSources(startOutputsOf(flow?.event), flow?.nodeKeys ?? [], byKey);
  const labelOf = (id: string): string => {
    const [node, key] = id.includes(":") ? id.split(":") : [undefined, id];
    const n = node ? byKey.get(node) : undefined;
    const name = n ? (i18n.language === "vi" ? n.label.vi : n.label.en) : undefined;
    return name ? `${name} · ${key}` : id;
  };
  return { sources, labelOf };
}

/** Tự nối: đầu vào của quy trình con có đúng MỘT nguồn cùng khoá + kiểu ⇒ nối luôn (luật chung `autoMapInputs`). */
function autoMap(
  needs: readonly ChildInput[],
  sources: readonly MapSource[],
): Record<string, string> {
  const ios = needs.flatMap((n) => {
    const type = inputSourceType(n.type);
    return type ? [{ key: n.key, type, required: n.required }] : [];
  });
  const { bound } = autoMapInputs(ios, sources, { node: SUBPROCESS_NODE });
  return Object.fromEntries(bound.map((b) => [b.key, b.source]));
}

type Setter = (next: SubprocessDraft) => void;

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 text-caption text-destructive">
      {children}
    </p>
  );
}

/** Ô tìm chọn quy trình con (tên + trạng thái); nháp không chọn được, nói số lượng để người dùng biết vì sao thiếu. */
function ChildPicker(p: {
  d: SubprocessDraft;
  options: ChildOption[];
  chosen: ChildOption | undefined;
  isLoading: boolean;
  readOnly: boolean;
  serverError: string | undefined;
  set: Setter;
}) {
  const { t } = useTranslation();
  const pickable = p.options.filter((o) => !o.disabled);
  const drafts = p.options.length - pickable.length;
  const lost = p.d.defKey !== "" && !p.chosen && !p.isLoading;
  return (
    <div className="space-y-1.5">
      <p className="m-0 text-label font-medium">{t(`${K}child`)}</p>
      <RefPicker
        label={p.chosen ? p.chosen.name : t(`${K}pick`)}
        placeholder={t(`${K}search`)}
        options={pickable.map((o) => ({
          id: o.key,
          label: o.name,
          hint: `${t(`${K}status.${o.status}`)} · ${t(`${K}steps`, { count: o.steps })}`,
        }))}
        selectedIds={p.d.defKey ? [p.d.defKey] : []}
        isLoading={p.isLoading}
        disabled={p.readOnly}
        onPick={(key) => p.set(withChild(p.d, key))}
      />
      {drafts > 0 ? (
        <p className="m-0 text-caption text-muted-foreground">
          {t(`${K}draftHidden`, { count: drafts })}
        </p>
      ) : null}
      {lost ? <Err>{t("process.admin.apiError.SUBPROCESS_NOT_FOUND")}</Err> : null}
      {p.serverError ? <Err>{t(p.serverError)}</Err> : null}
    </div>
  );
}

/** Quy trình con đã chọn: tên, trạng thái, liên kết mở, CẦN gì / TRẢ gì. */
function ChosenSummary(p: {
  chosen: ChildOption;
  tenantId: string | undefined;
  needs: ChildInput[];
  returns: { key: string }[];
}) {
  const { t } = useTranslation();
  const { chosen, needs, returns } = p;
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-x-3 text-body"
        data-testid="subprocess-chosen"
      >
        <span className="font-medium">{chosen.name}</span>
        <span className="text-caption text-muted-foreground">
          {t(`${K}status.${chosen.status}`)} · {t(`${K}steps`, { count: chosen.steps })}
        </span>
        <Link
          {...childEditorLink(chosen.id, p.tenantId)}
          data-testid="subprocess-panel-open"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          {t(`${K}open`)}
          <ExternalLink aria-hidden className="size-3" />
        </Link>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 text-caption" data-testid="subprocess-io">
        <div>
          <dt className="font-medium">{t(`${K}needs`)}</dt>
          <dd className="m-0 text-muted-foreground">
            {needs.length === 0
              ? t(`${K}needsNone`)
              : needs.map((n) => `${n.label}${n.required ? " *" : ""}`).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t(`${K}returns`)}</dt>
          <dd className="m-0 text-muted-foreground">
            {returns.length === 0 ? t(`${K}returnsNone`) : returns.map((r) => r.key).join(", ")}
          </dd>
        </div>
      </dl>
    </>
  );
}

/** Nối từng đầu vào của quy trình con với một nguồn ở các bước trước. */
function InputMap(p: {
  uid: string;
  d: SubprocessDraft;
  needs: ChildInput[];
  sources: MapSource[];
  labelOf: (id: string) => string;
  readOnly: boolean;
  set: Setter;
}) {
  const { t } = useTranslation();
  const missing = unmappedRequired(p.needs, p.d);
  return (
    <div className="space-y-2" data-testid="subprocess-map">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-label font-medium">{t(`${K}map`)}</p>
        {p.readOnly ? null : (
          <button
            type="button"
            className="text-caption text-primary hover:underline"
            onClick={() =>
              p.set({ ...p.d, inputMap: { ...autoMap(p.needs, p.sources), ...p.d.inputMap } })
            }
            data-testid="subprocess-automap"
          >
            {t(`${K}autoMap`)}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 items-start gap-3">
        {p.needs.map((n) => (
          <SelectField
            key={n.key}
            id={`${p.uid}-map-${n.key}`}
            label={`${n.label}${n.required ? " *" : ""}`}
            value={p.d.inputMap[n.key] ?? NONE}
            readOnly={p.readOnly}
            options={[
              { value: NONE, label: t(`${K}mapNone`) },
              ...p.sources.map((s) => ({ value: s.id, label: p.labelOf(s.id) })),
            ]}
            onChange={(v) => p.set(withMapping(p.d, n.key, v === NONE ? "" : v))}
          />
        ))}
      </div>
      {missing.length > 0 ? (
        <p className="m-0 text-caption text-warning" data-testid="subprocess-unmapped">
          {t(`${K}unmapped`, { names: missing.map((m) => m.label).join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

/** Vừa chọn xong và đã biết đầu vào của quy trình con ⇒ tự nối những đầu vào chỉ có một nguồn (một lần, khi chưa nối gì). */
function useAutoFill(a: {
  def: ProcessDef | undefined;
  key: string | undefined;
  d: SubprocessDraft;
  needs: ChildInput[];
  sources: MapSource[];
  readOnly: boolean;
  set: Setter;
}): void {
  const empty = Object.keys(a.d.inputMap).length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi đổi quy trình con / nạp xong định nghĩa của nó
  useEffect(() => {
    if (a.readOnly || a.needs.length === 0 || !empty) return;
    const m = autoMap(a.needs, a.sources);
    if (Object.keys(m).length > 0) a.set({ ...a.d, inputMap: m });
  }, [a.key, a.def]);
}

export function SubprocessPanel(p: NodePanelProps) {
  const { t } = useTranslation();
  const { stage, readOnly } = p;
  const d: SubprocessDraft = stage.subprocess ?? emptySubprocess();
  const { items, isLoading, tenantId } = useChildDefs();
  const { sources, labelOf } = useSources();
  const options = childOptions(items, undefined);
  const chosen = options.find((o) => o.key === d.defKey);
  const def = useProcessDef(chosen?.id, tenantId);
  const needs = childNeeds(def.data);
  const set: Setter = (next) => p.onChange({ subprocess: next });
  useAutoFill({ def: def.data, key: chosen?.key, d, needs, sources, readOnly, set });
  return (
    <fieldset
      className="space-y-3"
      data-testid="node-config-subprocess"
      aria-label={t(`${K}title`)}
    >
      <ChildPicker
        d={d}
        options={options}
        chosen={chosen}
        isLoading={isLoading}
        readOnly={readOnly}
        serverError={p.errors[`stages.${p.index}.executor.def_key`]}
        set={set}
      />
      {chosen ? (
        <ChosenSummary
          chosen={chosen}
          tenantId={tenantId}
          needs={needs}
          returns={childReturns(def.data)}
        />
      ) : null}
      {chosen && needs.length > 0 ? (
        <InputMap
          uid={stage.uid}
          d={d}
          needs={needs}
          sources={sources}
          labelOf={labelOf}
          readOnly={readOnly}
          set={set}
        />
      ) : null}
    </fieldset>
  );
}

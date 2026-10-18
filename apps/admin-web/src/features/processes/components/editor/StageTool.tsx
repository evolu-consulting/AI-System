// ADM-FR-71 · HUB-FR-146 · AC-H44 · AC-H47 · P-d2 (plan-frontend-d2 §10; mockup 04 E1/E2): khối stage "Gọi tool" — chọn tool khả dụng
// của công ty, bản đồ tham số, kết quả (tên tệp + trường). Nạp lười (chỉ khi chọn "Gọi tool"). Lỗi: live (cùng luật contract) + server.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldOptions, inputOptions, type ToolShape } from "../../domain/tool-rules";
import { useProcessTools } from "../../hooks/use-process-tools";
import { canRealAction } from "../../lib/def-form";
import { hasArg, setArg, switchTool, toolUsable } from "../../lib/tool-form";
import { SelectField, TextField } from "./Fields";
import { OutputFields } from "./OutputFields";
import type { StageFormProps } from "./stage-form-props";
import { ToolArgRow } from "./ToolArgRow";

const K = "process.admin.editor.stage.tool.";

function Note({ k, role, tone }: { k: string; role?: "status" | "alert"; tone?: string }) {
  const { t } = useTranslation();
  return (
    <Alert role={role} className={tone}>
      <AlertDescription>{t(k)}</AlertDescription>
    </Alert>
  );
}

type CatalogState = "template" | "loading" | "loadError" | "empty" | null;

/** Trạng thái danh sách tool: mẫu · đang tải · lỗi tải · rỗng · bình thường. */
function catalogState(
  c: { isTemplate: boolean; isPending: boolean; isError: boolean },
  count: number,
): CatalogState {
  if (c.isTemplate) return "template";
  if (c.isPending) return "loading";
  if (c.isError) return "loadError";
  return count === 0 ? "empty" : null;
}

function CatalogNote({ state, onRetry }: { state: CatalogState; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state === null || state === "loading") return null;
  if (state === "loadError")
    return (
      <Alert role="alert" variant="destructive" className="flex items-center gap-2">
        <AlertDescription className="flex-1">{t(`${K}loadError`)}</AlertDescription>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </Alert>
    );
  return (
    <Note k={`${K}${state}`} role="status" tone={state === "empty" ? "bg-warning-bg" : undefined} />
  );
}

/** Danh sách chọn: tool khả dụng (tool có tham số tệp ⇒ khoá); tool đang chọn đã mất ⇒ "(không còn)". */
function toolOptions(
  tools: readonly (ToolShape & { name: string })[],
  current: string,
  loaded: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  const opts = tools.map((x) => ({
    value: x.key,
    label: t(`${K}option`, { name: x.name, key: x.key }),
    disabled: !toolUsable(x),
  }));
  if (current !== "" && loaded && !tools.some((x) => x.key === current))
    opts.push({ value: current, label: t("process.admin.editor.gone"), disabled: false });
  return opts;
}
export default function StageTool(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all, errors, readOnly, onChange } = p;
  const cat = useProcessTools();
  const tools: readonly (ToolShape & { name: string })[] = cat.tools ?? [];
  const tool = tools.find((x) => x.key === stage.tool.key);
  const err = (f: string) => errors[`stages.${index}.${f}`];
  const tr = (k: string | undefined) => (k ? t(k) : undefined);
  const inputs = useMemo(() => p.defInputs ?? [], [p.defInputs]);
  const locked = cat.isTemplate || cat.isPending || cat.isError;
  const state = catalogState(cat, tools.length);
  const options = toolOptions(tools, stage.tool.key, cat.tools !== undefined, t);
  const pick = (key: string) => {
    const next = tools.find((x) => x.key === key);
    const prev = tool?.params ?? [];
    const side = next?.side_effect === true && canRealAction(all, index);
    onChange({
      tool: switchTool(stage.tool, key, prev, next?.params ?? []),
      ...(side ? { real: true } : {}),
    });
  };
  const missing = (tool?.params ?? []).some((x) => x.required && !hasArg(stage.tool, x.name));
  const ok =
    tool && !missing && !Object.keys(errors).some((k) => k.startsWith(`stages.${index}.executor`));
  return (
    <>
      <fieldset aria-label={t(`${K}title`)} className="space-y-3" data-testid="stage-tool">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-label font-medium">{t(`${K}title`)}</strong>
          <span className="flex gap-1.5">
            {tool?.side_effect ? <Badge variant="warn">{t(`${K}sideEffect`)}</Badge> : null}
            {ok ? <Badge variant="ok">{t("process.admin.editor.stage.wait.valid")}</Badge> : null}
          </span>
        </div>
        <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
        <SelectField
          id={`${stage.uid}-tool`}
          label={t(`${K}pick`)}
          value={stage.tool.key}
          readOnly={readOnly}
          disabled={locked}
          alert
          error={tr(err("executor.tool_key") ?? err("executor"))}
          placeholder={cat.isPending ? t(`${K}loading`) : t(`${K}pickPh`)}
          options={options}
          onChange={pick}
        />
        <CatalogNote state={state} onRetry={cat.refetch} />
        {tools.some((x) => !toolUsable(x)) ? (
          <p className="text-caption text-muted-foreground">{t(`${K}fileUnsupported`)}</p>
        ) : null}
        {tool?.side_effect ? <Note k={`${K}sideEffectNote`} /> : null}
        {tool?.params.map((x) => (
          <ToolArgRow
            key={`${stage.tool.key}:${x.name}`}
            param={x}
            arg={stage.tool.args[x.name]}
            inputs={inputOptions(inputs, x.type)}
            fields={fieldOptions(all, stage.step, x.type)}
            readOnly={readOnly}
            error={tr(err(`executor.args.${x.name}`))}
            onChange={(patch) => onChange({ tool: setArg(stage.tool, x.name, patch) })}
          />
        ))}
      </fieldset>
      <TextField
        id={`${stage.uid}-file`}
        label={t("process.admin.editor.stage.filename")}
        value={stage.filename}
        error={tr(err("output.filename"))}
        readOnly={readOnly}
        mono
        onChange={(v) => onChange({ filename: v })}
      />
      <OutputFields
        stage={stage}
        index={index}
        errors={errors}
        readOnly={readOnly}
        onChange={onChange}
      />
    </>
  );
}

// HUB-FR-119 · HUB-FR-126 · ADM-FR-65 · P-c1 F2 (plan-frontend §1.1; mockup Pc-Editor): khối "Tự sửa mã" của một giai đoạn —
// Switch + Nguồn + Lệnh kiểm thử/cài + Đường dẫn được sửa. Lỗi hiện `role=alert` ngay trong khối (live, cùng luật server).
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { withCurrent } from "../../hooks/use-editor-refs";
import {
  type AutofixDraft,
  autofixCrossErrors,
  autofixFieldErrors,
  autofixValid,
  otherAutofixName,
} from "../../lib/autofix-form";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.autofix.";

export function StageAutofix(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all, defSources, refs, readOnly, onChange } = p;
  const a = stage.autofix;
  const set = (patch: Partial<AutofixDraft>) => onChange({ autofix: { ...a, ...patch } });
  const kindOf = (key: string) => refs.sources.find((s) => s.key === key)?.kind;
  // Live (luật server) + lỗi gắn sau Lưu/Hub (`errors`); live thắng khi cùng ô.
  const cross = autofixCrossErrors(all);
  const errs: Record<string, string | undefined> = {
    ...p.errors,
    ...autofixFieldErrors(a, index),
    ...(a.on ? cross : {}),
  };
  const at = (f: string) => `stages.${index}.${f}`;
  const tr = (key: string | undefined) =>
    key
      ? t(key, { stage: otherAutofixName(all, index), key: a.source, kind: kindOf(a.source) ?? "" })
      : undefined;
  const fieldErr = (f: string) => (a.on ? tr(errs[at(`autofix.${f}`)]) : undefined);
  const blockErrs = a.on
    ? [
        errs[at("executor")] && !p.errors[at("executor")] ? errs[at("executor")] : undefined,
        errs[at("after")],
        errs[at("autofix")],
      ].filter((k): k is string => typeof k === "string" && k.startsWith(K))
    : [];
  const fieldInvalid = ["source_key", "test_cmd", "install_cmd", "write_allowlist"].some(
    (f) => fieldErr(f) !== undefined,
  );
  const options = withCurrent(
    defSources.map((k) => ({
      value: k,
      label: kindOf(k) ? `${k} · ${kindOf(k)}` : k,
    })),
    a.source,
    t("process.admin.editor.gone"),
  );
  const swId = `${stage.uid}-autofix`;
  return (
    <fieldset className="space-y-3" data-testid="stage-autofix">
      <div className="flex items-center gap-2">
        <Switch
          id={swId}
          checked={a.on}
          disabled={readOnly}
          onCheckedChange={(v) => set({ on: v })}
        />
        <Label htmlFor={swId} className="font-medium">
          {t(`${K}title`)}
        </Label>
        <span className="text-caption text-muted-foreground">
          {t(`${K}switch.${a.on ? "on" : "off"}`)}
        </span>
        {autofixValid(a, index) && blockErrs.length === 0 && !fieldInvalid ? (
          <Badge variant="ok">{t(`${K}valid`)}</Badge>
        ) : null}
      </div>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {a.on ? (
        <>
          {blockErrs.map((k) => (
            <Alert key={k} variant="destructive" role="alert" className="bg-danger-bg">
              <AlertDescription>{tr(k)}</AlertDescription>
            </Alert>
          ))}
          <SelectField
            id={`${swId}-source`}
            label={t(`${K}source.label`)}
            placeholder={t(`${K}source.ph`)}
            description={t(`${K}source.hint`)}
            value={a.source}
            readOnly={readOnly}
            error={fieldErr("source_key")}
            alert
            options={options}
            onChange={(v) => set({ source: v })}
          />
          <TextField
            id={`${swId}-test`}
            label={t(`${K}test.label`)}
            placeholder={t(`${K}test.ph`)}
            value={a.test}
            mono
            readOnly={readOnly}
            error={fieldErr("test_cmd")}
            alert
            onChange={(v) => set({ test: v })}
          />
          <TextField
            id={`${swId}-install`}
            label={t(`${K}install.label`)}
            placeholder={t(`${K}install.ph`)}
            value={a.install}
            mono
            readOnly={readOnly}
            error={fieldErr("install_cmd")}
            alert
            onChange={(v) => set({ install: v })}
          />
          <TextField
            id={`${swId}-allow`}
            label={t(`${K}allow.label`)}
            placeholder={t(`${K}allow.ph`)}
            description={t(`${K}allow.hint`)}
            value={a.allow}
            multiline
            rows={3}
            mono
            readOnly={readOnly}
            error={fieldErr("write_allowlist")}
            alert
            onChange={(v) => set({ allow: v })}
          />
          <Alert role="status">
            <AlertDescription>{t(`${K}net`)}</AlertDescription>
          </Alert>
        </>
      ) : null}
    </fieldset>
  );
}

// HUB-FR-61 · H4a-R05 · tuỳ chọn runtime `agentic-cli`: CLI, tool được phép, Bash + xác nhận bắt buộc, MCP, thư mục làm việc.
// Chỗ gắn của F5 (cảnh báo codex/gemini `editor.cliNotReady`, `max_turns`, nhãn "Lúc này chạy bằng").
import { CLI_KINDS, CWD_MODES, STUDIO_CLI_TOOLS } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Switch } from "#/components/ui/switch";
import { Field, type SectionProps } from "./AgentField";

function Tools({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const toggle = (tool: string, on: boolean) =>
    set("tools", on ? [...draft.tools, tool] : draft.tools.filter((x) => x !== tool));
  return (
    <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
      <legend className="mb-1 text-label font-medium">{t("editor.field.tools")}</legend>
      {STUDIO_CLI_TOOLS.map((tool) => (
        <div key={tool} className="flex items-center gap-2">
          <Checkbox
            id={`tool-${tool}`}
            checked={draft.tools.includes(tool)}
            onCheckedChange={(v) => toggle(tool, v === true)}
          />
          <Label htmlFor={`tool-${tool}`}>{tool}</Label>
        </div>
      ))}
    </fieldset>
  );
}

function BashAck({ draft, set, errors }: SectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Alert variant="destructive">
        <AlertDescription>{t("editor.bash.warn")}</AlertDescription>
      </Alert>
      <Field id="f-bash-ack" label="" error={errors.bash_ack} asLabel={false}>
        {(c) => (
          <div className="flex items-center gap-2">
            <Checkbox
              {...c}
              checked={draft.bashAck}
              onCheckedChange={(v) => set("bashAck", v === true)}
            />
            <Label htmlFor={c.id}>{t("editor.bash.ack")}</Label>
          </div>
        )}
      </Field>
    </div>
  );
}

export function CliOptions(p: SectionProps & { hadBash: boolean }) {
  const { t } = useTranslation();
  const { draft, set } = p;
  const askAck = draft.tools.includes("Bash") && !p.hadBash;
  return (
    <div className="space-y-4">
      <Field id="f-cli" label={t("editor.field.cli")} asLabel={false}>
        {(c) => (
          <RadioGroup
            {...c}
            aria-label={t("editor.field.cli")}
            className="flex gap-5"
            value={draft.cli}
            onValueChange={(v) => set("cli", v)}
          >
            {CLI_KINDS.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <RadioGroupItem id={`cli-${k}`} value={k} />
                <Label htmlFor={`cli-${k}`}>{k}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </Field>
      <Tools {...p} />
      {askAck ? <BashAck {...p} /> : null}
      <div className="flex items-center gap-2">
        <Switch id="f-mcp" checked={draft.mcp} onCheckedChange={(v) => set("mcp", v)} />
        <Label htmlFor="f-mcp">{t("editor.field.mcp")}</Label>
      </div>
      <p className="text-label text-muted-foreground">
        {t("editor.field.cwd")}: {CWD_MODES.join(", ")}. {t("editor.cwdHint")}
      </p>
    </div>
  );
}

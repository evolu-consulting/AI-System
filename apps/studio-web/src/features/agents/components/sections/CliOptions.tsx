// HUB-FR-61 · H4a-R05 · tuỳ chọn runtime `agentic-cli`: CLI, tool được phép, Bash + xác nhận bắt buộc, MCP, thư mục làm việc.
// Chỗ gắn của F5 (cảnh báo codex/gemini `editor.cliNotReady`, `max_turns`, nhãn "Lúc này chạy bằng").
import { CLI_KINDS, CWD_MODES, STUDIO_CLI_TOOLS } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { cliNotReady } from "../../lib/runtime-notice";
import { Field, type SectionProps } from "../editor/AgentField";

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
      {cliNotReady(draft.cli) ? (
        <Alert className="border-transparent bg-warning-bg text-warning">
          <AlertDescription className="text-warning">
            {t("editor.cliNotReady", { cli: draft.cli })}
          </AlertDescription>
        </Alert>
      ) : null}
      <Tools {...p} />
      {askAck ? <BashAck {...p} /> : null}
      <div className="flex items-center gap-2">
        <Switch id="f-mcp" checked={draft.mcp} onCheckedChange={(v) => set("mcp", v)} />
        <Label htmlFor="f-mcp">{t("editor.field.mcp")}</Label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="f-cwd" label={t("editor.field.cwd")} hint={t("editor.cwdHint")}>
          {(c) => (
            <Select value={draft.cwdMode} onValueChange={(v) => set("cwdMode", v)}>
              <SelectTrigger {...c} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CWD_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field id="f-max-turns" label={t("editor.field.maxTurns")} error={p.errors.max_turns}>
          {(c) => (
            <Input
              {...c}
              type="number"
              value={draft.maxTurns}
              onChange={(e) => set("maxTurns", e.target.value)}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

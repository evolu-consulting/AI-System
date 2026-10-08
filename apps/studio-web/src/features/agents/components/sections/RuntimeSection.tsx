// HUB-FR-60 · H4a-R03 · CR-054 · bước ② Runtime & model: runtime (chỉ chọn khi tạo — QB5), profile, model (agentic-cli),
// tuỳ chọn theo runtime, timeout, token.
// Trường không áp dụng cho runtime thì ẩn nhưng giữ giá trị trong nháp; khi gửi `toPayload` lọc theo runtime.

import type { ModelCatalogItem } from "@ai/contracts/studio";
import { AGENT_RUNTIMES } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
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
import type { AgentTypeItem, Catalog, ModelProfileItem } from "../../hooks/use-editor-catalogs";
import { markBadJson } from "../../lib/draft/draft";
import { runtimeMissing } from "../../lib/runtime-notice";
import { Field, type SectionProps } from "../editor/AgentField";
import { CatalogAlert } from "../editor/CatalogAlert";
import { CliOptions } from "./CliOptions";
import { ModelPicker } from "./ModelPicker";
import { SchemaForm } from "./SchemaForm";

type Props = SectionProps & {
  hadBash: boolean;
  profiles: Catalog<ModelProfileItem>;
  agentTypes: Catalog<AgentTypeItem>;
  models: Catalog<ModelCatalogItem>;
};

function CatalogSelect(p: {
  id: string;
  label: string;
  value: string;
  error?: string;
  items: { key: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Field id={p.id} label={p.label} error={p.error}>
      {(c) => (
        <Select value={p.value} onValueChange={p.onChange}>
          <SelectTrigger {...c} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {p.items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

function PythonOptions(p: Props) {
  const { t } = useTranslation();
  const { draft, set, errors } = p;
  const types = p.agentTypes.items.filter((x) => x.runtime === "python");
  const schema = types.find((x) => x.key === draft.agentTypeKey)?.config_schema;
  return (
    <>
      {p.agentTypes.failed ? (
        <CatalogAlert what={t("editor.field.agentType")} retry={p.agentTypes.retry} />
      ) : null}
      <CatalogSelect
        id="f-agent-type"
        label={t("editor.field.agentType")}
        value={draft.agentTypeKey}
        error={errors.agent_type_key}
        items={types.map((x) => ({ key: x.key, value: x.key }))}
        onChange={(v) => {
          if (v !== draft.agentTypeKey) {
            set("rawOptions", {});
            set("badJson", []);
          }
          set("agentTypeKey", v);
        }}
      />
      {schema ? (
        <SchemaForm
          key={draft.agentTypeKey}
          schema={schema}
          value={draft.rawOptions}
          onChange={(v) => set("rawOptions", v)}
          onBad={(id, bad) => {
            const next = markBadJson(draft.badJson, id, bad);
            if (next !== draft.badJson) set("badJson", next);
          }}
        />
      ) : null}
    </>
  );
}

function RuntimeSpecific(p: Props) {
  const { t } = useTranslation();
  const { draft, set, errors } = p;
  const needsProfile = ["llm", "agentic-cli", "python"].includes(draft.runtime);
  return (
    <>
      {needsProfile ? (
        <>
          {p.profiles.failed ? (
            <CatalogAlert what={t("editor.field.profile")} retry={p.profiles.retry} />
          ) : null}
          <CatalogSelect
            id="f-profile"
            label={t("editor.field.profile")}
            value={draft.profileId}
            error={errors.profile_id}
            items={p.profiles.items.map((x) => ({ key: x.key, value: x.id }))}
            onChange={(v) => set("profileId", v)}
          />
        </>
      ) : null}
      {draft.runtime === "agentic-cli" ? <ModelPicker {...p} /> : null}
      {draft.runtime === "python" ? <PythonOptions {...p} /> : null}
      {draft.runtime === "agentic-cli" ? <CliOptions {...p} /> : null}
    </>
  );
}

export function RuntimeSection(p: Props) {
  const { t } = useTranslation();
  const { draft, set, errors, mode } = p;
  return (
    <div className="space-y-4">
      <Field
        id="f-runtime"
        label={t("editor.field.runtime")}
        asLabel={false}
        hint={mode === "edit" ? t("editor.runtimeLocked") : undefined}
      >
        {(c) => (
          <RadioGroup
            {...c}
            aria-label={t("editor.field.runtime")}
            className="flex flex-wrap gap-5"
            value={draft.runtime}
            disabled={mode === "edit"}
            onValueChange={(v) => set("runtime", v as typeof draft.runtime)}
          >
            {AGENT_RUNTIMES.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <RadioGroupItem id={`rt-${r}`} value={r} />
                <Label htmlFor={`rt-${r}`}>{r}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </Field>
      {runtimeMissing(
        draft.runtime,
        p.agentTypes.items,
        !p.agentTypes.pending && !p.agentTypes.failed,
      ) ? (
        <Alert className="border-transparent bg-warning-bg text-warning">
          <AlertDescription className="text-warning">{t("editor.runtimeMissing")}</AlertDescription>
        </Alert>
      ) : null}
      <RuntimeSpecific {...p} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="f-timeout" label={t("editor.field.timeout")} error={errors.timeout_s}>
          {(c) => (
            <Input
              {...c}
              type="number"
              value={draft.timeout}
              onChange={(e) => set("timeout", e.target.value)}
            />
          )}
        </Field>
        <Field id="f-token" label={t("editor.field.tokenBudget")} error={errors.token_budget}>
          {(c) => (
            <Input
              {...c}
              type="number"
              value={draft.tokenBudget}
              onChange={(e) => set("tokenBudget", e.target.value)}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

// HUB-FR-60 · bước ④ System prompt (tối đa 20 000 ký tự, theo contract).
import { useTranslation } from "react-i18next";
import { Textarea } from "#/components/ui/textarea";
import { Field, type SectionProps } from "../editor/AgentField";

export function PromptSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Field id="f-prompt" label={t("editor.field.prompt")}>
      {(c) => (
        <Textarea
          {...c}
          rows={8}
          className="font-mono"
          value={draft.prompt}
          onChange={(e) => set("prompt", e.target.value)}
        />
      )}
    </Field>
  );
}

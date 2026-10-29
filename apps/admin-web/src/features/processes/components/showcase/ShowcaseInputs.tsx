// CR-103 · R4 fnr-showcase: form input của flow mẫu + nút "Chạy thử" + hai kịch bản điền sẵn. Trình bày thuần.
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { inputIssues, SHOWCASE_PRESETS } from "../../lib/showcase";
import { TextField } from "../editor/Fields";

const K = "process.admin.showcase.";
type Props = {
  inputs: readonly ProcessInputDef[];
  pending: boolean;
  error: string | null;
  onRun: (raw: Record<string, string>) => void;
};

export function ShowcaseInputs({ inputs, pending, error, onRun }: Props) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const issues = inputIssues(inputs, raw);
  const submit = () => {
    setTried(true);
    if (Object.keys(issues).length === 0) onRun(raw);
  };
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap gap-2">
        {SHOWCASE_PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRaw({ ...p.values })}
          >
            {t(`${K}preset.${p.id}`)}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {inputs.map((d) => {
          const issue = tried ? issues[d.key] : undefined;
          return (
            <TextField
              key={d.key}
              id={`showcase-in-${d.key}`}
              label={d.label}
              type={d.type === "number" ? "number" : "text"}
              value={raw[d.key] ?? ""}
              alert
              error={issue ? t(`${K}issue.${issue}`) : undefined}
              onChange={(v) => setRaw((r) => ({ ...r, [d.key]: v }))}
            />
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-label text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(`${K}run`)}
      </Button>
    </form>
  );
}

// CHAT-AC-56 · PF3 (full view): giai đoạn + các bản kết quả. Mỗi stage có output ⇒ chọn phiên bản (`tablist`) rồi
// `OutputView` (lười theo `output_id`). Trình bày; không fetch ở đây (OutputView tự nạp).
import type { StageView } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { OutputView } from "../../shared/components/OutputView";

export function StageOutputs({ runId, stage }: { runId: string; stage: StageView }) {
  const { t } = useTranslation();
  const versions = stage.outputs;
  const [sel, setSel] = useState(stage.current_output_id ?? versions.at(-1)?.id ?? "");
  if (versions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-semibold">
        {t("process.inbox.run.outputTitle", {
          stage: stage.name,
          n: versions.find((o) => o.id === sel)?.version ?? versions.at(-1)?.version ?? 1,
        })}
      </h3>
      {versions.length > 1 && (
        <div role="tablist" aria-label={t("process.run.pane.versions")} className="flex gap-1">
          {versions.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={o.id === sel}
              onClick={() => setSel(o.id)}
              className={cn(
                "rounded-md px-2 py-0.5 text-caption font-medium",
                o.id === sel ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              v{o.version}
            </button>
          ))}
        </div>
      )}
      {sel && <OutputView runId={runId} outputId={sel} />}
    </section>
  );
}

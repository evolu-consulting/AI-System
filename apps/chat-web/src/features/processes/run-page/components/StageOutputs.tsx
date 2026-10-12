// CHAT-AC-56 · P-b2 plan-frontend §5: giai đoạn + các bản kết quả. > 1 phiên bản ⇒ Tabs "Bản n" (mới nhất chọn sẵn; bản của vòng
// trước ghi "trước khi quay lại"), mỗi tab lười nạp `OutputView`. 1 phiên bản ⇒ như cũ. Không fetch ở đây.
import type { StageView } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { OutputView } from "../../shared/components/OutputView";

export function StageOutputs({ runId, stage }: { runId: string; stage: StageView }) {
  const { t } = useTranslation();
  const versions = stage.outputs;
  const latest = versions.at(-1);
  const [picked, setPicked] = useState<string | null>(null);
  if (!latest) return null;
  // Chưa chọn (hoặc bản đã chọn không còn) ⇒ theo bản mới nhất, kể cả khi bản mới về sau.
  const sel = versions.find((o) => o.id === picked) ?? latest;
  const title = (
    <h4 className="text-sm font-semibold">
      {t("process.inbox.run.outputTitle", { stage: stage.name, n: sel.version })}
    </h4>
  );
  if (versions.length === 1) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        {title}
        <OutputView runId={runId} outputId={latest.id} />
      </section>
    );
  }
  const lastRound = latest.round ?? 1;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      {title}
      <Tabs value={sel.id} onValueChange={setPicked}>
        <TabsList aria-label={t("process.run.version.label")}>
          {versions.map((o) => (
            <TabsTrigger key={o.id} value={o.id}>
              {t("process.run.version.tab", { n: o.version })}
              {o.id === latest.id && (
                <span className="ml-1 text-caption font-normal">
                  · {t("process.run.version.latest")}
                </span>
              )}
              {o.id !== latest.id && (o.round ?? 1) < lastRound && (
                <span className="ml-1 text-caption font-normal">
                  · {t("process.run.version.old")}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {versions.map((o) => (
          <TabsContent key={o.id} value={o.id}>
            <OutputView runId={runId} outputId={o.id} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

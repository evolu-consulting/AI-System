// ADM-FR-23 · X1 F4 · kết quả "Chạy thử" (plan-frontend §2.2): dòng "{ms} ms · {in}+{out} token", tab Kết quả · Raw · Các bước;
// `ok:false` → Alert 1 dòng + "Chi tiết từ Dify" (ẩn khi `detail` null). Không thêm lib markdown: `<pre>` xuống dòng.
import type { CommandTestResponse } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PRE =
  "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-label";

function RunFailed({ error }: { error: Extract<CommandTestResponse, { ok: false }>["error"] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Alert variant="destructive">
        <AlertDescription>
          <span>{error.message}</span> <span className="font-mono text-caption">{error.code}</span>
        </AlertDescription>
      </Alert>
      {error.detail ? (
        <Collapsible>
          <CollapsibleTrigger className="text-label underline-offset-4 hover:underline">
            {t("commands.test.difyDetail")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className={PRE}>{error.detail}</pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

export function TestResult({ result }: { result: CommandTestResponse }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="font-mono text-label text-muted-foreground">
        {t("commands.test.summary", {
          ms: result.ms,
          in: result.usage.input_tokens,
          out: result.usage.output_tokens,
        })}
      </p>
      {result.ok ? null : <RunFailed error={result.error} />}
      <Tabs defaultValue="result">
        <TabsList aria-label={t("commands.test.title")}>
          <TabsTrigger value="result">{t("commands.test.tabResult")}</TabsTrigger>
          <TabsTrigger value="raw">{t("commands.test.tabRaw")}</TabsTrigger>
          <TabsTrigger value="steps">{t("commands.test.tabSteps")}</TabsTrigger>
        </TabsList>
        <TabsContent value="result" className="pt-2">
          {result.ok ? <pre className={PRE}>{result.output}</pre> : null}
        </TabsContent>
        <TabsContent value="raw" className="pt-2">
          <pre className={`${PRE} font-mono`}>{JSON.stringify(result, null, 2)}</pre>
        </TabsContent>
        <TabsContent value="steps" className="pt-2">
          <ol className="space-y-1">
            {result.steps.map((s, i) => (
              // Nhãn bước có thể trùng (retry) ⇒ khoá theo vị trí.
              // biome-ignore lint/suspicious/noArrayIndexKey: danh sách tĩnh, không sắp lại
              <li key={i} className="flex items-center gap-2 text-label">
                <span>{s.label}</span>
                <StatusBadge tone={s.status === "ok" ? "ok" : "err"}>
                  {t(s.status === "ok" ? "commands.test.stepOk" : "commands.test.stepFailed")}
                </StatusBadge>
                <span className="ml-auto font-mono text-caption text-muted-foreground">
                  {s.ms} ms
                </span>
              </li>
            ))}
          </ol>
        </TabsContent>
      </Tabs>
    </div>
  );
}

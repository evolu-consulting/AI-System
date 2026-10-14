// HUB-FR-128 · P-c1 §1.3 · "Cần người quyết" autofix_check_failed: lỗi nhóm theo `check` (paths → apply_patch), đuôi 30 dòng log test.
// Bí mật chỉ `path:line · quy tắc rule` (FC6, không `detail`). `failures` rỗng ⇒ câu "Không nhận được báo cáo kiểm".
// Bản chép: admin-web `components/run/autofix/AutofixFailures.tsx` (TECH-DEBT FC2).
import type { AutofixStageView } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { failureGroups, isSecretFailure, secondsLabel } from "../lib/autofix-view";
import { type LoadContent, useAutofixLog, useDownload } from "./use-autofix-content";

const K = "process.common.autofix.";
type Failure = AutofixStageView["failures"][number];
/** P-c2: dùng chung cho `ApplyStageView` (cùng `failures`/`test_log_file`, không có `test`). */
type FailView = Pick<AutofixStageView, "failures" | "test_log_file"> & {
  test?: AutofixStageView["test"];
};

function TestLog({ view, load }: { view: FailView; load: LoadContent }) {
  const { t } = useTranslation();
  const file = view.test_log_file;
  const log = useAutofixLog(file?.id ?? null, load, true, 30);
  const download = useDownload(load);
  if (!file) return null;
  return (
    <>
      {log.text !== null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-caption">
          {log.text}
        </pre>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => void download(file)}
      >
        {t(`${K}fullLog`)}
      </Button>
    </>
  );
}

function lineText(f: Failure, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (isSecretFailure(f)) {
    return t(`${K}secret.line`, { path: f.path ?? "", line: f.line ?? 0, rule: f.rule ?? "" });
  }
  return f.path ? `${f.path} · ${f.detail}` : f.detail;
}

function AutofixFailuresImpl({ view, load }: { view: FailView | undefined; load: LoadContent }) {
  const { t, i18n } = useTranslation();
  const groups = view ? failureGroups(view) : [];
  if (!view || groups.length === 0) {
    return <p className="text-caption text-muted-foreground">{t(`${K}decision.check.empty`)}</p>;
  }
  const sec = secondsLabel(view.test?.duration_ms ?? 0, i18n.language);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-destructive">
            {t(`${K}group.${g}`, { code: view.test?.exit_code ?? "-", sec })}
          </span>
          <ul className="list-disc space-y-0.5 pl-5 text-caption">
            {view.failures
              .filter((f) => f.check === g)
              .map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: danh sách tĩnh, không sắp xếp lại
                <li key={i} className="break-all">
                  {lineText(f, t)}
                </li>
              ))}
          </ul>
          {g === "tests" && <TestLog view={view} load={load} />}
        </div>
      ))}
    </div>
  );
}

export const AutofixFailures = memo(AutofixFailuresImpl);

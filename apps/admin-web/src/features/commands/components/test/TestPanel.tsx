// ADM-FR-23 · X1 F4 · panel "Chạy thử" (plan-frontend §2.2, ui-admin §7.4): chạy BẢN NHÁP đang sửa (kể cả chưa lưu) qua
// `POST /admin/commands/test`; Ctrl+Enter chạy; "Dừng" huỷ fetch; 409 side effect → hộp xác nhận. Trang đã `PlatformOnly`.

import { TEST_RUN_TEXT_MAX } from "@ai/contracts/hub-internal";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeCommandTestError, isRunAsError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import { useCommandTest } from "../../hooks/use-command-test";
import type { CommandFormValues } from "../../lib/schemas";
import { buildSyntax } from "../../lib/syntax";
import {
  buildTestBody,
  draftCommand,
  emptyTestInput,
  pageUrlValid,
  type TestInput,
  textValid,
} from "../../lib/test-run";
import { type RunAs, RunAsPicker } from "./RunAsPicker";
import { SideEffectConfirm } from "./SideEffectConfirm";
import { TestResult } from "./TestResult";

function useDraft() {
  const form = useFormContext<CommandFormValues>();
  const values = useWatch({ control: form.control }) as CommandFormValues;
  const hasErrors = Object.keys(form.formState.errors).length > 0;
  return { form, values, blocked: hasErrors || !values.workflow_id };
}

export function TestPanel() {
  const { t } = useTranslation();
  const tr = useTr();
  const { form, values, blocked } = useDraft();
  const test = useCommandTest();
  const [input, setInput] = useState<TestInput>(emptyTestInput);
  const [runAs, setRunAs] = useState<RunAs>(null);
  const urlOk = pageUrlValid(input.pageUrl);
  const textOk = textValid(input.text);
  const running = test.state.status === "running";
  const set = (k: keyof TestInput) => (e: { target: { value: string } }) =>
    setInput((s) => ({ ...s, [k]: e.target.value }));

  const start = async () => {
    if (running || blocked || !urlOk || !textOk) return;
    if (!(await form.trigger())) return;
    const body = buildTestBody(form.getValues(), { ...input, runAsUserId: runAs?.id ?? "" });
    void test.run(body);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void start();
    } else if (e.target instanceof HTMLInputElement) {
      e.preventDefault(); // Enter trong ô của panel không được gửi form lưu command.
    }
  };

  const err = test.state.status === "error" ? test.state.error : null;
  const errLines = err
    ? describeCommandTestError(err, values.name).map((m) => tr(m.key, m.params))
    : [];
  const untested = form.formState.isDirty && test.tested !== JSON.stringify(draftCommand(values));

  return (
    // Ctrl+Enter bắt ở cả panel; mỗi ô vẫn dùng bàn phím bình thường.
    <section aria-labelledby="cmd-test-title" className="space-y-4" onKeyDown={onKeyDown}>
      <div>
        <h2 id="cmd-test-title" className="font-semibold text-heading">
          {t("commands.test.title")}
        </h2>
        <p className="text-caption text-muted-foreground">{t("commands.test.hint")}</p>
      </div>
      <FormField id="cmd-test-text" label={t("commands.test.text")}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={TEST_RUN_TEXT_MAX}
            value={input.text}
            onChange={set("text")}
            placeholder={buildSyntax(values.name || "…", values.args ?? [])}
          />
        )}
      </FormField>
      <FormField id="cmd-test-selection" label={t("commands.test.selection")}>
        {(p) => <Textarea {...p} rows={2} value={input.selection} onChange={set("selection")} />}
      </FormField>
      <FormField
        id="cmd-test-url"
        label={t("commands.test.pageUrl")}
        error={urlOk ? undefined : t("commands.test.pageUrlInvalid")}
      >
        {(p) => (
          <Input
            {...p}
            type="url"
            value={input.pageUrl}
            onChange={set("pageUrl")}
            autoComplete="off"
            className="font-mono"
          />
        )}
      </FormField>
      <RunAsPicker
        value={runAs}
        onChange={setRunAs}
        error={isRunAsError(err) ? errLines.join(" ") : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <Button type="button" disabled aria-busy>
              {t("commands.test.running")}
            </Button>
            <Button type="button" variant="outline" onClick={test.stop}>
              {t("commands.test.stop")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => void start()}
            disabled={blocked || !urlOk || !textOk}
            aria-keyshortcuts="Control+Enter"
          >
            {t("commands.test.run")}
          </Button>
        )}
        {blocked ? (
          <span className="text-caption text-muted-foreground">{t("commands.test.fixForm")}</span>
        ) : untested ? (
          <span className="text-caption text-muted-foreground">{t("commands.test.untested")}</span>
        ) : null}
      </div>
      {errLines.length ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errLines.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {test.state.status === "done" ? (
        <TestResult result={test.state.result} />
      ) : test.state.status === "idle" ? (
        <p className="text-caption text-muted-foreground">{t("commands.test.empty")}</p>
      ) : null}
      <SideEffectConfirm open={test.confirmOpen} onConfirm={test.confirm} onCancel={test.cancel} />
    </section>
  );
}

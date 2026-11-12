// CR-127 · U3 · BR-17 · mock M3 `TestRun`: «Chạy thử» quy trình theo sự kiện — không tạo dữ liệu thật. Bản nháp đang mở (chưa lưu cũng chạy).
// Thay `PreviewDialog` (khe cũ). Đường đi + người nhận việc + cảnh báo do Hub trả (một nguồn luật với engine); ở đây chỉ nhập và hiển thị.
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { notifyError } from "@ai/web-kit/ui/toast";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentUserOptions } from "@/features/agents/api";
import { useTestRun } from "../../hooks/use-test-run";
import { processErrorSpec } from "../../lib/errors";
import {
  buildFacts,
  buildRequest,
  type Decision,
  type DecisionResult,
  decide,
  factFieldsOf,
  type PreviewResponse,
  type Row,
  type RunSource,
  rowsOf,
  type ScenarioResponse,
  scenarioRowsOf,
  summaryOf,
  warningRows,
} from "../../lib/test-run";
import { TestRunPath } from "./TestRunPath";
import { TestRunForm, TestRunQuick } from "./TestRunSide";

type LooseT = (key: string, opts?: Record<string, unknown>) => string;
const useLooseT = () => useTranslation() as unknown as { t: LooseT };
const K = "process.admin.flow.testRun.";

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  name: string;
  event: AppEventDecl | undefined;
  /** Bản nháp đang mở — gọi lúc bấm (không dựng lại mỗi lần render). */
  source: () => RunSource;
};

export function TestRunDialog({ open, onClose, tenantId, name, event, source }: Props) {
  const { t } = useLooseT();
  const { run, scenarios } = useTestRun(tenantId);
  const users = useAgentUserOptions(tenantId, open);
  const fields = useMemo(() => factFieldsOf(event), [event]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [starter, setStarter] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [res, setRes] = useState<PreviewResponse | null>(null);
  const [quick, setQuick] = useState<ScenarioResponse | null>(null);
  const built = buildFacts(fields, raw);
  const userOpts = (users.data ?? []).map((u) => ({ value: u.id, label: u.name || u.username }));

  const fail = (err: unknown) => {
    const s = processErrorSpec(err);
    notifyError(t(s.key, s.params));
  };
  const go = async (next: Decision[]) => {
    if (built.invalid.length > 0) return;
    try {
      setRes(await run.mutateAsync(buildRequest(source(), built.facts, starter, next)));
      setDecisions(next);
    } catch (err) {
      fail(err);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy một lần lúc mở; nhập lại ⇒ «Chạy lại từ đầu»
  useEffect(() => {
    if (open) void go([]);
  }, [open]);
  const onDecide = (r: Row, result: DecisionResult, actor: string | null) =>
    void go(decide(decisions, r.stepKey, result, actor));
  const runQuick = async () => {
    try {
      setQuick(await scenarios.mutateAsync(buildRequest(source(), built.facts, starter)));
    } catch (err) {
      fail(err);
    }
  };
  const busy = run.isPending || scenarios.isPending;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"
        data-testid="testrun-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t(`${K}title`, { name })}</DialogTitle>
          <DialogDescription data-testid="testrun-banner">{t(`${K}banner`)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[18rem_1fr_16rem]">
          <TestRunForm
            fields={fields}
            raw={raw}
            invalid={built.invalid}
            onRaw={(k, v) => setRaw((p) => ({ ...p, [k]: v }))}
            users={userOpts}
            starter={starter}
            onStarter={setStarter}
            warnings={warningRows(res?.warnings ?? [])}
          />
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <b>{t(`${K}path`)}</b>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void go([])}
                data-testid="testrun-restart"
              >
                {t(`${K}restart`)}
              </Button>
            </div>
            {res ? (
              <TestRunPath
                rows={rowsOf(res)}
                summary={summaryOf(res)}
                busy={busy}
                onDecide={onDecide}
              />
            ) : (
              <p className="text-muted-foreground">{t(`${K}loading`)}</p>
            )}
          </section>
          <TestRunQuick
            rows={quick ? scenarioRowsOf(quick) : null}
            busy={busy}
            onRun={() => void runQuick()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

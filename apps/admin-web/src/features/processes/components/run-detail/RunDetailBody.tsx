// CR-121 · R-3: thân trang "Chi tiết lượt chạy" (admin): đầu trang · sơ đồ · dòng thời gian · ngăn nhật ký bước · thao tác có lý do.

import type { RunControlReason } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { cn } from "@/lib/utils";
import type { ProcessTenant } from "../../hooks/use-process-tenant";
import { useRun } from "../../hooks/use-run-live";
import { companySearch } from "../../lib/company-copy";
import {
  type ControlRole,
  canReopenUi,
  canRerunStepUi,
  controlErrorKey,
  isPackBoundError,
  runControls,
} from "../../lib/run-detail-view";
import {
  useReopenContract,
  useRunControl,
  useRunDetail,
  useSourceHref,
  useStageLog,
} from "../../run-detail-api";
import { AutofixBlocks } from "../run/autofix/AutofixBlocks";
import { OutputDialog, type OutputTarget } from "../run/OutputDialog";
import { RunActions } from "../run/RunActions";
import { UsageTab } from "../usage/UsageTab";
import { ControlDialog, type ControlTarget } from "./ControlDialog";
import { RunFlow } from "./RunFlow";
import { RunHeader } from "./RunHeader";
import { RunTimeline } from "./RunTimeline";
import { StepDrawer } from "./StepDrawer";

type Props = { runId: string; tenant: ProcessTenant };

export function RunDetailBody({ runId, tenant }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const detail = useRunDetail(runId, tenant.tenantId);
  const full = useRun(runId, tenant.tenantId, 5000);
  const ctl = useRunControl(runId, tenant.tenantId);
  const [sel, setSel] = useState<number | null>(null);
  const [target, setTarget] = useState<ControlTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packBound, setPackBound] = useState(false);
  const [output, setOutput] = useState<OutputTarget | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const reopen = useReopenContract();
  const log = useStageLog(runId, sel, tenant.tenantId);
  const run = detail.data;
  const sourceHref = useSourceHref(run?.source ?? null);
  if (!run) return null;
  const role = tenant.me?.role as ControlRole;
  const controls = runControls(run.status, role, packBound);
  const step = sel === null ? undefined : run.steps.find((s) => s.idx === sel);

  const isPlatform = role === "platform_admin";
  const doReopen = async (contractId: string, reason: RunControlReason, text?: string) => {
    await reopen.mutateAsync({
      contractId,
      reason: text ?? t(`process.admin.runDetail.ctl.reason.${reason}`),
      ...(isPlatform ? { platformTenantId: run.tenant.id } : {}),
    });
    notifySuccess(t("process.admin.runDetail.ctl.reopen.done"));
    setTarget(null);
  };
  const doControl = async (
    tg: Exclude<ControlTarget, { op: "reopen" }>,
    reason: RunControlReason,
  ) => {
    const out = await ctl.mutateAsync(
      tg.op === "rerun-step"
        ? { op: "rerun-step", reason, stageIdx: tg.idx }
        : { op: tg.op, reason },
    );
    notifySuccess(t(`process.admin.runDetail.ctl.${tg.op}.done`));
    const newId = (out as { id?: unknown } | null)?.id;
    setTarget(null);
    setSel(null);
    if (tg.op === "rerun" && typeof newId === "string" && newId !== runId)
      void navigate({
        to: "/processes/$processId/runs/$runId",
        params: { processId: run.process.key, runId: newId },
        search: companySearch(run.tenant.id),
      });
  };
  const confirm = async (reason: RunControlReason, text?: string) => {
    if (!target) return;
    setError(null);
    try {
      if (target.op === "reopen") await doReopen(target.contractId, reason, text);
      else await doControl(target, reason);
    } catch (err) {
      if (target.op === "rerun" && isPackBoundError(err)) {
        setPackBound(true); // lượt gắn gói: không chạy lại cả lượt được (mở lại ở gói hợp đồng)
        setTarget(null);
        return;
      }
      setError(t(controlErrorKey(err)));
    }
  };

  return (
    <div className="space-y-4">
      <RunHeader
        run={run}
        controls={controls}
        packBound={packBound}
        sourceHref={sourceHref}
        canReopen={canReopenUi(role, run.source, run.tenant.id, tenant.me?.tenant.id)}
        onReopen={() => run.source && setTarget({ op: "reopen", contractId: run.source.id })}
        nowMs={Date.now()}
        onStop={() => setTarget({ op: "stop" })}
        onRerun={() => setTarget({ op: "rerun" })}
        onRerunFromIf={() => setTarget({ op: "rerun-from-if" })}
      />
      <div className="rounded-lg border border-border bg-card">
        <RunFlow steps={run.steps} selected={sel} onSelect={setSel} />
      </div>
      {full.data?.access === "full" && (
        <>
          <RunActions run={full.data} tenantId={tenant.tenantId} />
          <AutofixBlocks stages={full.data.stages} tenantId={tenant.tenantId} />
        </>
      )}
      <RunTimeline items={run.timeline} processKey={run.process.key} company={run.tenant.id} />
      <section className="rounded-lg border border-border bg-card">
        <button
          type="button"
          aria-expanded={usageOpen}
          onClick={() => setUsageOpen((o) => !o)}
          className="flex w-full items-center gap-2 p-3 text-left text-label font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", !usageOpen && "-rotate-90")}
          />
          {t("process.admin.run.tab.usage")}
        </button>
        {usageOpen && (
          <div className="p-3 pt-0">
            <UsageTab runId={runId} tenantId={tenant.tenantId} />
          </div>
        )}
      </section>
      <StepDrawer
        idx={sel}
        fallbackName={step?.name ?? ""}
        log={log.data}
        loading={log.isPending && sel !== null}
        failed={log.isError}
        canRerunStep={!!step && canRerunStepUi(role, run.status, step.raw_status)}
        onRerunStep={(idx, name) => setTarget({ op: "rerun-step", idx, name })}
        onViewOutput={setOutput}
        onClose={() => setSel(null)}
      />
      <ControlDialog
        target={target}
        pending={ctl.isPending || reopen.isPending}
        error={error}
        freeReason={isPlatform}
        onCancel={() => {
          setTarget(null);
          setError(null);
        }}
        onConfirm={(r, text) => void confirm(r, text)}
      />
      <OutputDialog
        runId={runId}
        tenantId={tenant.tenantId}
        target={output}
        stages={full.data?.access === "full" ? full.data.stages : []}
        onClose={() => setOutput(null)}
      />
    </div>
  );
}

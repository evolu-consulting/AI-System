// CR-125 · cr125-manual-start-ui · trang MỘT yêu cầu: tên, trạng thái, nội dung phiếu đã điền. cr125-request-steps: toàn bộ các bước của lượt
// và lượt con (Phần 1/2/3 …) lồng dưới lượt cha; việc của người xem ở bất kỳ lượt nào (form «Gửi», Duyệt / Trả lại / Từ chối, thẻ nhóm cùng
// duyệt) làm ngay tại đây qua `RunStepActions` (cùng component với thẻ HĐ). Mở từ lượt con ⇒ chuyển sang lượt gốc, nhìn vào lượt con đó.
// Quyền xem do hub quyết (người gửi · người được giao · quản trị), ngoài ra 404.
import type { EvidenceInput } from "@ai/contracts/chat";
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fileIdsOf } from "~/components/shared/attachments";
import { FileName } from "~/components/shared/FileUploadField";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { notifyFlowNavChanged } from "~/shared/kernel/flow-nav-event";
import { decideTask, fetchRequest, RESULT_OF_ACTION, requestKeys } from "../api";
import { RequestStepsTree, StepActions } from "../components/RequestStepsTree";
import { firstActionable, redirectToRoot } from "../lib/request-tree";
import {
  currentNode,
  summaryOf,
  summaryText,
  type Waiting,
  waitingOf,
  waitingText,
} from "../lib/request-view";

const money = (v: string): string => Number(v).toLocaleString("vi-VN");

export function RequestPage({
  runId,
  sent,
  focus,
}: {
  runId: string;
  sent?: "new" | "again" | undefined;
  /** Mã lượt con cần nhìn vào (từ «Chờ tôi duyệt» của lượt con). */
  focus?: string | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: requestKeys.one(runId),
    queryFn: ({ signal }) => fetchRequest(runId, signal),
    refetchInterval: (s) => (s.state.data?.run.status === "done" ? false : 5000),
    retry: false,
  });
  const changed = () => {
    void qc.invalidateQueries({ queryKey: requestKeys.one(runId) });
    void qc.invalidateQueries({ queryKey: requestKeys.tasks });
    notifyFlowNavChanged();
  };
  const decide = useMutation({
    mutationFn: (a: {
      n: RequestStepNode;
      taskId: string;
      action: string;
      feedback?: string;
      evidence?: EvidenceInput;
    }) =>
      decideTask(
        a.taskId,
        RESULT_OF_ACTION[a.action] ?? "pass",
        a.feedback,
        a.action === "return" ? a.n.back_to_step : null,
        a.evidence,
      ),
    onSuccess: changed,
  });
  const toRoot = q.data ? redirectToRoot(runId, q.data.root_run_id) : null;
  useEffect(() => {
    if (toRoot)
      void navigate({
        to: "/contracts/requests/$runId",
        params: { runId: toRoot.runId },
        search: { focus: toRoot.focus },
        replace: true,
      });
  }, [toRoot, navigate]);
  const target = focus ?? runId;
  useEffect(() => {
    if (q.data)
      document
        .querySelector(`[data-run="${CSS.escape(target)}"]`)
        ?.scrollIntoView?.({ block: "center" });
  }, [q.data, target]);
  const back = (
    <Link to="/contracts/requests" className="hover:underline">
      {t("contracts.requests.back")}
    </Link>
  );
  if (q.isPending || toRoot) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data)
    return (
      <div data-testid="request-missing">
        <PageHead title={t("contracts.requests.statusTitle")} crumb={back} />
        <p role="alert" className="text-sm text-late">
          {t("contracts.requests.notFound")}
        </p>
      </div>
    );
  const { run, title, fields, steps } = q.data;
  const mine = firstActionable(steps);
  const treeProps = {
    focus,
    busy: decide.isPending,
    error: decide.isError,
    onChanged: changed,
    onDecide: (
      n: RequestStepNode,
      taskId: string,
      action: string,
      feedback?: string,
      evidence?: EvidenceInput,
    ) =>
      decide
        .mutateAsync({
          n,
          taskId,
          action,
          ...(feedback ? { feedback } : {}),
          ...(evidence ? { evidence } : {}),
        })
        .then(() => undefined),
  };
  const waiting = waitingOf(steps, run.status);
  const waitLine = waitingLine(t, waiting);
  const summary = summaryText(
    summaryOf(fields, "started_by" in run ? run.started_by.display_name : undefined),
    t("contracts.requests.proposer"),
  );
  const nextWho = waiting.kind === "waiting" ? waiting.items.find((i) => i.who)?.who : undefined;
  return (
    <div data-testid="request-page">
      <PageHead title={title} crumb={back} />
      {summary && (
        <p className="mb-2 mt-0 text-sm text-dim" data-testid="request-summary">
          {summary}
        </p>
      )}
      {sent && (
        <p role="status" className="mb-3 text-sm text-ok" data-testid="request-sent">
          {sentNote(t, sent, nextWho)}
        </p>
      )}
      <Panel className="mb-4 max-w-2xl px-6 py-4">
        <p className="m-0 text-sm">
          <span className="text-dim">{t("contracts.requests.statusLabel")}: </span>
          <b data-testid="request-status" data-status={run.status}>
            {t(`contracts.requests.status.${run.status}`)}
          </b>
        </p>
        {waitLine && (
          <p className="mb-0 mt-1 text-sm" data-testid="request-waiting">
            {waitLine}
          </p>
        )}
      </Panel>
      {mine && (
        <Panel className="mb-4 max-w-2xl border-act px-6 py-4">
          <div data-testid="request-action-bar">
            <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.myTask")}</h2>
            <StepActions node={mine} {...treeProps} />
          </div>
        </Panel>
      )}
      {fields.length > 0 && (
        <Panel className="mb-4 max-w-2xl px-6 py-4">
          <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.formData")}</h2>
          <dl
            className="m-0 grid grid-cols-[minmax(8rem,12rem)_1fr] gap-x-4 gap-y-2"
            data-testid="request-fields"
          >
            {fields.map((f) => (
              <div key={f.key} className="contents" data-testid={`request-field-${f.key}`}>
                <dt className="text-sm text-dim">{f.label}</dt>
                <dd className="m-0 whitespace-pre-wrap text-sm">
                  {f.type === "money" ? (
                    money(f.value)
                  ) : f.type === "attachments" ? (
                    <FileLinks value={f.value} />
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel className="mb-4 max-w-2xl px-6 py-4">
        <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.steps")}</h2>
        <div data-testid="request-steps">
          <RequestStepsTree
            node={steps}
            currentRunId={currentNode(steps, focus).run_id}
            hoistedRunId={mine?.run_id ?? null}
            {...treeProps}
          />
        </div>
      </Panel>
      {decide.isSuccess && !mine && (
        <p role="status" className="text-sm text-ok" data-testid="request-decided">
          {t("contracts.requests.decided")}{" "}
          <Link
            to="/contracts/approvals"
            className="font-semibold underline"
            data-testid="request-next"
          >
            {t("contracts.requests.nextWork")}
          </Link>
        </p>
      )}
    </div>
  );
}

/** «Đang chờ: <ai> · Phần N – <bước>»; đã xong (dòng Trạng thái đã nói) hoặc không ai giữ việc ⇒ null. */
function waitingLine(t: TFunction, w: Waiting): string | null {
  if (w.kind !== "waiting") return null;
  return t("contracts.requests.waitingFor", {
    text: waitingText(w.items, t("contracts.requests.part")),
  });
}

/** Lời sau khi gửi: bước tiếp là ai (nếu biết) + sẽ có thông báo; gửi lại cùng mã ⇒ «đã gửi trước đó». */
function sentNote(t: TFunction, sent: "new" | "again", nextWho: string | null | undefined): string {
  if (sent !== "new") return t("contracts.requests.reusedNote");
  return nextWho
    ? t("contracts.requests.sentNext", { who: nextWho })
    : t("contracts.requests.sentNoNext");
}

/** Ô «Tệp đính kèm» đã gửi: mỗi tệp một liên kết mở tệp (hub kiểm quyền xem lượt); giá trị không đọc ra id ⇒ chỉ đếm. */
function FileLinks({ value }: { value: string }) {
  const { t } = useTranslation();
  const ids = fileIdsOf(value);
  if (ids.length === 0)
    return <>{t("contracts.requests.filesCount", { count: value.split(", ").length })}</>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {ids.map((id) => (
        <li key={id}>
          <FileName id={id} />
        </li>
      ))}
    </ul>
  );
}

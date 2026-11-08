// CR-125 · cr125-manual-start-ui · trang MỘT yêu cầu: tên, trạng thái, nội dung phiếu đã điền, các bước; người được giao duyệt thấy nút
// Duyệt / Từ chối ngay trên thẻ (cùng dữ liệu phiếu). Quyền xem do hub quyết (người gửi · người được giao · quản trị), ngoài ra 404.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { decideTask, fetchRequest, requestKeys } from "../api";

const money = (v: string): string => Number(v).toLocaleString("vi-VN");

export function RequestPage({
  runId,
  sent,
}: {
  runId: string;
  sent?: "new" | "again" | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: requestKeys.one(runId),
    queryFn: ({ signal }) => fetchRequest(runId, signal),
    refetchInterval: (s) => (s.state.data?.run.status === "done" ? false : 5000),
    retry: false,
  });
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const decide = useMutation({
    mutationFn: (r: "pass" | "reject") =>
      decideTask(openTask(q.data)?.id ?? "", r, reason.trim() || undefined),
    onSuccess: () => {
      setRejecting(false);
      void qc.invalidateQueries({ queryKey: requestKeys.one(runId) });
      void qc.invalidateQueries({ queryKey: requestKeys.tasks });
    },
  });
  const back = (
    <Link to="/contracts/requests" className="hover:underline">
      {t("contracts.requests.back")}
    </Link>
  );
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data)
    return (
      <div data-testid="request-missing">
        <PageHead title={t("contracts.requests.statusTitle")} crumb={back} />
        <p role="alert" className="text-sm text-late">
          {t("contracts.requests.notFound")}
        </p>
      </div>
    );
  const { run, title, fields } = q.data;
  const task = openTask(q.data);
  return (
    <div data-testid="request-page">
      <PageHead title={title} crumb={back} />
      {sent && (
        <p role="status" className="mb-3 text-sm text-ok" data-testid="request-sent">
          {t(sent === "new" ? "contracts.requests.createdNote" : "contracts.requests.reusedNote")}
        </p>
      )}
      <Panel className="mb-4 max-w-2xl px-6 py-4">
        <p className="m-0 text-sm">
          <span className="text-dim">{t("contracts.requests.statusLabel")}: </span>
          <b data-testid="request-status" data-status={run.status}>
            {t(`contracts.requests.status.${run.status}`)}
          </b>
        </p>
      </Panel>
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
                  {f.type === "money"
                    ? money(f.value)
                    : f.type === "attachments"
                      ? t("contracts.requests.filesCount", { count: f.value.split(", ").length })
                      : f.value}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel className="mb-4 max-w-2xl px-6 py-4">
        <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.steps")}</h2>
        <ol className="m-0 list-none p-0" data-testid="request-steps">
          {run.stages.map((s) => (
            <li key={s.idx} className="flex items-center gap-3 py-1 text-sm" data-status={s.status}>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-label text-dim">
                {t(`contracts.requests.stage.${s.status}`)}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
      {task && (
        <Panel className="max-w-2xl px-6 py-4">
          <div data-testid="request-task">
            <h2 className="mb-2 text-[15px] font-semibold">
              {t("contracts.requests.myTask")} · {task.stage_name}
            </h2>
            {rejecting ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="req-reject" className="text-sm">
                  {t("contracts.requests.rejectReason")}
                </label>
                <textarea
                  id="req-reject"
                  rows={3}
                  className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={decide.isPending || reason.trim() === ""}
                    data-testid="request-reject-confirm"
                    onClick={() => decide.mutate("reject")}
                  >
                    {t("contracts.requests.reject")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={decide.isPending}
                  data-testid="request-approve"
                  onClick={() => decide.mutate("pass")}
                >
                  {t("contracts.requests.approve")}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="request-reject"
                  onClick={() => setRejecting(true)}
                >
                  {t("contracts.requests.reject")}
                </button>
              </div>
            )}
            {decide.isError && (
              <p role="alert" className="mt-2 text-sm text-late">
                {t("contracts.requests.decideError")}
              </p>
            )}
          </div>
        </Panel>
      )}
      {decide.isSuccess && !task && (
        <p role="status" className="text-sm text-ok" data-testid="request-decided">
          {t("contracts.requests.decided")}
        </p>
      )}
    </div>
  );
}

function openTask(d: Awaited<ReturnType<typeof fetchRequest>> | undefined) {
  return d?.run.my_tasks.find((x) => x.status === "open" && x.can_act && x.kind === "review");
}

// dlc-progress · dòng tiến độ của lượt DLC trên thẻ khung nhập: bước quy trình, việc queue đang làm (+ agent), số việc xong,
// nút mở thread của agent đang chạy và danh sách việc (mở rộng). Mỗi việc của queue chạy trong thread riêng ⇒ không có dòng
// này người không biết lượt đang ở đâu. Lỗi / không quyền ⇒ ẩn.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { fetchDlcProgress } from "../api";

const POLL_MS = 10_000;

/** `dlc-the-memories-frontend` ⇒ `frontend` (vai của agent domain); khác ⇒ giữ nguyên. */
export const agentRole = (key: string): string => key.split("-").pop() ?? key;

const TASK_TONE: Record<string, string> = {
  in_progress: "text-primary font-medium",
  ready_to_deploy: "text-secondary-foreground line-through",
  deployed: "text-secondary-foreground line-through",
  failed: "text-destructive",
};

export function DlcProgress(p: { runId: string; conversationId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["process", "dlc-progress", p.runId],
    queryFn: ({ signal }) => fetchDlcProgress(p.runId, signal),
    retry: false,
    refetchInterval: (s) => (s.state.status === "error" ? false : POLL_MS),
  });
  const v = q.data;
  if (!v?.step) return null;
  const agent = v.agent;
  const openThread = () =>
    agent &&
    void navigate({
      to: "/c/$id",
      params: { id: p.conversationId },
      search: { flow: agent.flow_id },
    });
  return (
    <div className="flex w-full flex-col gap-1 text-caption text-secondary-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {t("process.run.dlcProgress.step", {
            n: v.step.idx + 1,
            total: v.step.total,
            name: v.step.name,
          })}
        </span>
        {v.tasks.length > 0 && (
          <span>
            · {t("process.run.dlcProgress.done", { done: v.done, total: v.tasks.length })}
          </span>
        )}
        {v.current && (
          <span className="text-foreground">
            ·{" "}
            {t("process.run.dlcProgress.current", {
              id: v.current.id.split("-").pop(),
              title: v.current.title,
              role: agent ? agentRole(agent.agent) : "",
            })}
          </span>
        )}
        {agent && (
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto p-0"
            onClick={openThread}
          >
            {t(
              agent.status === "running"
                ? "process.run.dlcProgress.openRunning"
                : "process.run.dlcProgress.openLast",
            )}
          </Button>
        )}
      </div>
      {v.tasks.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none">
            {t("process.run.dlcProgress.tasks")}
          </summary>
          <ol className="mt-1 flex flex-col gap-0.5 pl-4">
            {v.tasks.map((x) => (
              <li key={x.id} className={cn(TASK_TONE[x.status])}>
                {x.id.split("-").pop()} · {x.title}{" "}
                <span className="text-secondary-foreground">
                  ({t(`process.run.dlcProgress.status.${x.status}`, { defaultValue: x.status })}
                  {x.domain ? `, ${x.domain}` : ""}
                  {x.attempts > 1
                    ? `, ${t("process.run.dlcProgress.attempt", { n: x.attempts })}`
                    : ""}
                  )
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

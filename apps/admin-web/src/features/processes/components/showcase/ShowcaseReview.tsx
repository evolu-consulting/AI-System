// CR-103 · R4 fnr-showcase: nút Đạt / Từ chối cho task duyệt đang mở của người xem (`run.my_tasks`, `can_act`) — `RunActions`
// chỉ lo "Cần người quyết"/Huỷ nên duyệt Đạt/Từ chối nằm riêng ở đây.
import type { TaskDetail } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { useReviewDecision } from "../../hooks/use-run-data";
import { processErrorSpec } from "../../lib/errors";

const K = "process.admin.showcase.review.";
type Props = { tasks: readonly TaskDetail[]; tenantId: string | undefined };

export function ShowcaseReview({ tasks, tenantId }: Props) {
  const { t } = useTranslation();
  const m = useReviewDecision(tenantId);
  const open = tasks.filter((x) => x.kind === "review" && x.status === "open" && x.can_act);
  if (open.length === 0) return null;
  const busy = (id: string) => m.isPending && m.variables?.taskId === id;
  const send = (taskId: string, result: "pass" | "reject") =>
    m.mutate(
      { taskId, result, feedback: result === "reject" ? t(`${K}rejectNote`) : undefined },
      {
        onError: (err) => {
          const s = processErrorSpec(err);
          notifyError(t(s.key, s.params));
        },
      },
    );
  return (
    <ul className="space-y-2" data-testid="showcase-review">
      {open.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2">
          <span className="text-label font-medium">{t(`${K}stage`, { name: x.stage_name })}</span>
          <Button type="button" size="sm" disabled={busy(x.id)} onClick={() => send(x.id, "pass")}>
            {t(`${K}pass`)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy(x.id)}
            onClick={() => send(x.id, "reject")}
          >
            {t(`${K}reject`)}
          </Button>
        </li>
      ))}
    </ul>
  );
}

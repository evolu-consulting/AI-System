// contract-flow S3b · "Việc của tôi" cho HĐ chạy duyệt trên engine: task duyệt MỞ mà người xem quyết được (`openTasksOf` — MỘT câu hub,
// scope user, cùng luật `canAct`: Group duyệt, head_only, chuyển cấp, exclude_starter) + nhãn HĐ (MỘT câu gói, RLS M1 — HĐ người xem
// không thấy bị bỏ). Tổng 2 câu SQL, không phụ thuộc số task. Lớp 2.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { MYWORK_MAX, type MyWorkApproval } from "../domain/mywork.types";
import type { ApprovalEnginePort, ApprovalEngineRepo } from "./approval-engine.ports";

export type MyApprovalsDeps = {
  port: () => Pick<ApprovalEnginePort, "openTasksOf"> | undefined;
  uow: PackUow<{ approvalEngine: Pick<ApprovalEngineRepo, "labels"> }>;
};

export function myApprovals(d: MyApprovalsDeps) {
  return async (who: PackWho): Promise<MyWorkApproval[]> => {
    const port = d.port();
    if (!port) return [];
    const tasks = (await port.openTasksOf({ ...who, role: "member" }, "contracts")).slice(
      0,
      MYWORK_MAX,
    );
    if (tasks.length === 0) return [];
    const ids = [...new Set(tasks.map((t) => t.record_id))];
    const rows = await d.uow.tenant(who, (r) => r.approvalEngine.labels(ids));
    const by = new Map(rows.map((c) => [c.id, c]));
    return tasks.flatMap((t) => {
      const c = by.get(t.record_id);
      if (!c) return [];
      return [
        {
          task_id: t.task_id,
          contract_id: t.record_id,
          contract_number: c.number,
          contract_title: c.title,
          stage_name: t.stage_name,
          due_at: t.due_at,
          escalated: t.escalated,
        },
      ];
    });
  };
}

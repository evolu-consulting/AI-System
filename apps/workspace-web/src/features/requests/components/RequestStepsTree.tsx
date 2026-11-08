// CR-125 · cr125-request-steps · các bước của yêu cầu + lượt con (Phần 1/2/3 …) lồng dưới lượt cha. Mỗi lượt vẽ bằng `RunStepActions` — CÙNG
// component với thẻ HĐ cho việc của người xem (form «Gửi», Duyệt / Trả lại / Từ chối), nên làm việc ngay trên trang này.
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { RunStepActions, useFlowSubmitForm } from "~/platform/flow";

type Props = {
  node: RequestStepNode;
  focus?: string | undefined;
  busy: boolean;
  error: boolean;
  onChanged: () => void;
  onDecide: (
    n: RequestStepNode,
    taskId: string,
    action: string,
    feedback?: string,
  ) => Promise<void>;
  depth?: number;
};

export function RequestStepsTree({ node, depth = 0, ...p }: Props) {
  const { t } = useTranslation();
  const submit = useFlowSubmitForm({
    slot: node.flow.slot,
    refId: node.run_id,
    onDone: p.onChanged,
  });
  return (
    <section
      data-run={node.run_id}
      data-run-status={node.status}
      data-focused={p.focus === node.run_id ? "true" : undefined}
      className={depth > 0 ? "mt-3 border-l-2 border-rule-soft pl-4" : ""}
    >
      <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {depth > 0 && (
          <span className="text-label font-normal text-dim">
            {t(`contracts.requests.status.${node.status}`, { defaultValue: node.status })}
          </span>
        )}
      </h3>
      <RunStepActions
        slot={node.flow.slot}
        refId={node.run_id}
        view={node.flow}
        busy={p.busy}
        error={p.error}
        onSubmitForm={(taskId, values) => submit.mutateAsync({ taskId, values })}
        onDecide={(taskId, action, feedback) => p.onDecide(node, taskId, action, feedback)}
      />
      {node.children.map((c) => (
        <RequestStepsTree key={c.run_id} node={c} depth={depth + 1} {...p} />
      ))}
    </section>
  );
}

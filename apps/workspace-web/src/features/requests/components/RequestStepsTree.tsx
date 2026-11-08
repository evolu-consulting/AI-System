// CR-125 · cr125-request-steps · các bước của yêu cầu + lượt con (Phần 1/2/3 …) lồng dưới lượt cha. Mỗi lượt vẽ bằng `RunStepActions` — CÙNG
// component với thẻ HĐ. CR-126: lượt có việc của người xem được kéo lên thanh đầu trang (`StepActions` ở RequestPage, một component duy nhất,
// `hoistedRunId`) nên cây không vẽ lại nút; chỉ Phần hiện tại mở sẵn, các Phần khác bấm để mở.
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RunStepActions, useFlowSubmitForm } from "~/platform/flow";

export type TreeProps = {
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
};
type Props = TreeProps & {
  node: RequestStepNode;
  /** Phần mở sẵn. */
  currentRunId: string;
  /** Lượt đã vẽ ở thanh đầu trang (không vẽ nút lần nữa). */
  hoistedRunId?: string | null | undefined;
  depth?: number;
};

/** Các bước + nút Gửi form / Duyệt / Trả lại / Từ chối của MỘT lượt — dùng ở thanh đầu trang và trong cây. */
export function StepActions({ node, ...p }: TreeProps & { node: RequestStepNode }) {
  const submit = useFlowSubmitForm({
    slot: node.flow.slot,
    refId: node.run_id,
    onDone: p.onChanged,
  });
  return (
    <RunStepActions
      slot={node.flow.slot}
      refId={node.run_id}
      view={node.flow}
      busy={p.busy}
      error={p.error}
      onSubmitForm={(taskId, values) => submit.mutateAsync({ taskId, values })}
      onDecide={(taskId, action, feedback) => p.onDecide(node, taskId, action, feedback)}
    />
  );
}

export function RequestStepsTree({ node, depth = 0, ...p }: Props) {
  const { t } = useTranslation();
  const isCurrent = p.currentRunId === node.run_id || p.focus === node.run_id;
  const [open, setOpen] = useState(isCurrent);
  const hoisted = p.hoistedRunId === node.run_id;
  return (
    <section
      data-run={node.run_id}
      data-run-status={node.status}
      data-focused={p.focus === node.run_id ? "true" : undefined}
      className={depth > 0 ? "mt-3 border-l-2 border-rule-soft pl-4" : ""}
    >
      <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
        <button
          type="button"
          aria-expanded={open}
          data-testid="request-part-toggle"
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        <span className="text-label font-normal text-dim">
          {t(`contracts.requests.status.${node.status}`, { defaultValue: node.status })}
        </span>
      </h3>
      {open &&
        (hoisted ? (
          <p className="m-0 text-caption text-dim">{t("contracts.requests.doneAbove")}</p>
        ) : (
          <StepActions node={node} {...p} />
        ))}
      {node.children.map((c) => (
        <RequestStepsTree key={c.run_id} node={c} depth={depth + 1} {...p} />
      ))}
    </section>
  );
}

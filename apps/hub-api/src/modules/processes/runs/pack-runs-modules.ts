// CR-123 · u6 · FLOW3-FR-14 · một việc nghiệp vụ = MỘT dòng: các stage của một node module (Ký số = gửi + chờ ký xong) gộp thành một
// bước của `stepsView` — MỘT nguồn cho thẻ duyệt và mọi client. Cụm theo `moduleClusters` (@ai/contracts/hub-admin); trạng thái nghiệp vụ
// lấy từ stage CHỜ: chưa tới / đang chờ / xong (`done` hoặc nhánh theo sự kiện: từ chối) / hết hạn (stage xong không có sự kiện = timeout).
// Luật thuần, O(số stage), không I/O.
import { type ClusterStage, moduleClusters } from "@ai/contracts/hub-admin";
import { MODULES } from "@ai/contracts/modules";
import { sql } from "drizzle-orm";
import type { PackModuleOutcome, PackStepView } from "../../packs/kit/public";

/** Tên người / Group ký: MỘT câu chỉ khi có người ký cấu hình (đường thường không thêm câu nào). Scope người xem (RLS). */
export async function signerNamesOf(
  tx: { execute: (q: ReturnType<typeof sql>) => PromiseLike<Iterable<Record<string, unknown>>> },
  tenantId: string,
  refs: readonly string[],
): Promise<Map<string, string>> {
  const users = refs.filter((r) => r.startsWith("user:")).map((r) => r.slice(5));
  const groups = refs.filter((r) => r.startsWith("group:")).map((r) => r.slice(6));
  if (users.length + groups.length === 0) return new Map();
  const rows = [
    ...((await tx.execute(sql`
      select 'user:' || u.id::text as k, coalesce(nullif(u.display_name, ''), u.username) as n
        from admin.users u where u.tenant_id = ${tenantId} and u.id = any(${`{${users.join(",")}}`}::uuid[])
      union all
      select 'group:' || g.id::text, coalesce(nullif(g.name->>'vi', ''), nullif(g.name->>'en', ''), g.key) from admin.groups g
        where g.tenant_id = ${tenantId} and g.id = any(${`{${groups.join(",")}}`}::uuid[])`)) as Iterable<{
      k: string;
      n: string;
    }>),
  ];
  return new Map(rows.map((r) => [r.k, r.n]));
}

export type StageFact = {
  /** `hub.stage_runs.status`. */
  stageStatus: string;
  /** Sự kiện đã tiêu thụ bởi stage (`process_run_events.consumed_by`); null = không có (timeout / chưa tới). */
  consumed: string | null;
};

type Exit = { key: string; on?: readonly string[] };
const exitsOf = (node: string): readonly Exit[] =>
  (MODULES.flatMap((m) => m.nodes).find((n) => n.key === node)?.exits as readonly Exit[]) ?? [];

/** Nhánh ra của node theo sự kiện đã tiêu thụ; sự kiện không khai báo ở nhánh nào ⇒ `done`; không sự kiện (timeout) ⇒ nhánh `timeout`. */
function exitKey(node: string, consumed: string | null): PackModuleOutcome {
  const exits = exitsOf(node);
  const want = consumed ?? "timeout";
  const hit = exits.find((x) => x.on?.includes(want));
  if (hit) return hit.key as PackModuleOutcome;
  return consumed === null ? "expired" : "done";
}

const STATUS: Record<PackModuleOutcome, PackStepView["status"]> = {
  pending: "pending",
  waiting: "running",
  done: "passed",
  declined: "rejected",
  expired: "failed",
  failed: "failed",
};

function outcomeOf(node: string, facts: readonly StageFact[]): PackModuleOutcome {
  const wait = facts.at(-1) as StageFact;
  // Gửi/chờ lỗi hết lượt (run chờ người quyết) ⇒ KHÔNG nói "Đang chờ ký": việc chưa chạy được, cần xử lý.
  if (facts.some((f) => f.stageStatus === "needs_decision" || f.stageStatus === "failed"))
    return "failed";
  if (wait.stageStatus === "done") return exitKey(node, wait.consumed);
  const started = facts.some((f) => f.stageStatus !== "pending" && f.stageStatus !== "queued");
  return started ? "waiting" : "pending";
}

const SIGNER = /^(user|group):([0-9a-f-]{36})$/i;
type ArgStage = { executor?: { args?: Record<string, unknown> } };
/** Người ký công ty cấu hình ở `args.company_signers` của stage gửi (`user:<id>,group:<id>`) ⇒ khoá `kind:id`. */
export function signerRefs(stage: unknown): string[] {
  const arg = (stage as ArgStage | null)?.executor?.args?.company_signers;
  // Tham số của stage là nguồn giá trị `{from:"const", value}` (def lưu từ canvas); chuỗi trần giữ cho def cũ.
  const raw = typeof arg === "object" && arg !== null ? (arg as { value?: unknown }).value : arg;
  if (typeof raw !== "string") return [];
  return raw.split(",").flatMap((p) => (SIGNER.test(p.trim()) ? [p.trim().toLowerCase()] : []));
}

/** Gộp mỗi cụm module thành một bước (lấy khoá/tên/vị trí của stage đầu); stage ngoài cụm giữ nguyên. */
export function collapseModuleSteps(
  steps: readonly PackStepView[],
  stages: readonly ClusterStage[],
  facts: readonly StageFact[],
  signerNames: ReadonlyMap<string, string> = new Map(),
): PackStepView[] {
  const clusters = moduleClusters(stages);
  if (clusters.length === 0) return [...steps];
  const out: PackStepView[] = [];
  let i = 0;
  while (i < steps.length) {
    const c = clusters.find((x) => x.start === i);
    const head = steps[i] as PackStepView;
    if (!c) {
      out.push(head);
      i++;
      continue;
    }
    // CR-126 · stage người làm bên trong node (form «Chọn đối tác & người nhận») đang mở ⇒ dòng = CHÍNH bước người làm (task + form),
    // KHÔNG gắn `module`: thẻ/FlowView vẽ bước có `module` thành bước tự động (bỏ form) ⇒ người được giao không thấy form để điền.
    const open = steps.slice(c.start, c.end).find((s) => s.task !== null && s.status === "open");
    if (open) {
      out.push(open);
      i = c.end;
      continue;
    }
    const outcome = outcomeOf(c.node, facts.slice(c.start, c.end));
    const signer = signerRefs(stages[c.start])
      .flatMap((k) => signerNames.get(k) ?? [])
      .join(", ")
      .slice(0, 200);
    out.push({
      ...head,
      status: STATUS[outcome],
      task: null,
      module: { node: c.node, outcome, ...(signer ? { signer } : {}) },
    });
    i = c.end;
  }
  return out;
}
